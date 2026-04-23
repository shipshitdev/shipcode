import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { GitHubIssueQueries } from './github-issues';
import { IssueEdgeQueries } from './issue-edges';
import { ProjectQueries } from './projects';

describe('IssueEdgeQueries', () => {
  let db: DatabaseSync;
  let projects: ProjectQueries;
  let githubIssues: GitHubIssueQueries;
  let issueEdges: IssueEdgeQueries;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    projects = new ProjectQueries(db);
    githubIssues = new GitHubIssueQueries(db);
    issueEdges = new IssueEdgeQueries(db);
    projectId = projects.add('/tmp/test-project').id;
  });

  afterEach(() => {
    db.close();
  });

  function createIssue(issueNumber: number, title = `Issue ${issueNumber}`) {
    return githubIssues.upsert({
      projectId,
      issueNumber,
      title,
      body: `Body for ${title}`,
      labels: [],
      assignee: null,
      state: 'open',
    });
  }

  it('replaces body-derived edges for a single issue and leaves other issue bodies intact', () => {
    const issue1 = createIssue(1);
    const issue2 = createIssue(2);
    const issue3 = createIssue(3);

    issueEdges.replaceBodyEdges(projectId, issue1.id, [
      {
        sourceIssueId: issue1.id,
        targetIssueId: issue2.id,
        edgeType: 'blocks',
      },
    ]);
    issueEdges.replaceBodyEdges(projectId, issue3.id, [
      {
        sourceIssueId: issue2.id,
        targetIssueId: issue3.id,
        edgeType: 'depends_on',
      },
    ]);

    issueEdges.replaceBodyEdges(projectId, issue1.id, [
      {
        sourceIssueId: issue1.id,
        targetIssueId: issue3.id,
        edgeType: 'reference',
      },
    ]);

    const graph = issueEdges.loadProjectGraph(projectId);
    expect(graph.edges.map((edge) => [edge.sourceIssueNumber, edge.targetIssueNumber, edge.edgeType])).toEqual([
      [1, 3, 'reference'],
      [2, 3, 'depends_on'],
    ]);
    expect(graph.edges.every((edge) => edge.origin === 'body')).toBe(true);
  });

  it('creates and deletes manual edges', () => {
    const issue1 = createIssue(1);
    const issue2 = createIssue(2);

    const created = issueEdges.createManualEdge({
      projectId,
      sourceIssueId: issue1.id,
      targetIssueId: issue2.id,
      edgeType: 'blocks',
    });

    expect(created.origin).toBe('manual');
    expect(created.sourceIssueNumber).toBe(1);
    expect(created.targetIssueNumber).toBe(2);

    expect(issueEdges.deleteEdge(created.id)).toBe(true);
    expect(issueEdges.deleteEdge(created.id)).toBe(false);
    expect(issueEdges.loadProjectGraph(projectId).edges).toEqual([]);
  });

  it('returns a project-scoped graph with issue nodes and sorted edges', () => {
    const issue1 = createIssue(1, 'First');
    const issue2 = createIssue(2, 'Second');
    const issue3 = createIssue(3, 'Third');

    githubIssues.updatePipelineStatus(issue2.id, 'executing');
    issueEdges.createManualEdge({
      projectId,
      sourceIssueId: issue1.id,
      targetIssueId: issue2.id,
      edgeType: 'blocks',
    });
    issueEdges.replaceBodyEdges(projectId, issue3.id, [
      {
        sourceIssueId: issue2.id,
        targetIssueId: issue3.id,
        edgeType: 'depends_on',
      },
    ]);

    const graph = issueEdges.loadProjectGraph(projectId);

    expect(graph.projectId).toBe(projectId);
    expect(graph.nodes.map((node) => [node.issueNumber, node.title, node.pipelineStatus])).toEqual([
      [1, 'First', 'todo'],
      [2, 'Second', 'executing'],
      [3, 'Third', 'todo'],
    ]);
    expect(graph.edges.map((edge) => [edge.sourceIssueNumber, edge.targetIssueNumber, edge.edgeType, edge.origin])).toEqual([
      [1, 2, 'blocks', 'manual'],
      [2, 3, 'depends_on', 'body'],
    ]);
  });

  it('skips self-edges when replacing parsed body edges', () => {
    const issue1 = createIssue(1);

    issueEdges.replaceBodyEdges(projectId, issue1.id, [
      {
        sourceIssueId: issue1.id,
        targetIssueId: issue1.id,
        edgeType: 'blocks',
      },
    ]);

    expect(issueEdges.loadProjectGraph(projectId).edges).toEqual([]);
  });

  it('rejects manual self-edges', () => {
    const issue1 = createIssue(1);

    expect(() =>
      issueEdges.createManualEdge({
        projectId,
        sourceIssueId: issue1.id,
        targetIssueId: issue1.id,
        edgeType: 'blocks',
      }),
    ).toThrow(/self edge/i);
  });
});
