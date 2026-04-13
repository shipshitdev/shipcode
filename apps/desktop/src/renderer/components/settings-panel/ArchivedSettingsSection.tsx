import type { GitHubIssueCacheRecord, Project } from '@shipcode/shared';
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@shipcode/ui';

export function ArchivedSettingsSection({
  archivedProjects,
  archivedIssues,
  unarchiveProjectPending,
  unarchiveIssuePending,
  onUnarchiveProject,
  onUnarchiveIssue,
}: {
  archivedProjects: Project[];
  archivedIssues: GitHubIssueCacheRecord[];
  unarchiveProjectPending: boolean;
  unarchiveIssuePending: boolean;
  onUnarchiveProject: (projectId: string) => void;
  onUnarchiveIssue: (issueId: string) => void;
}) {
  return (
    <>
      <h3 className="mb-5">Archived</h3>
      <Tabs defaultValue="projects">
        <TabsList className="mb-5">
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="issues">Issues</TabsTrigger>
        </TabsList>

        <TabsContent value="projects">
          <section className="mb-8">
            <p className="mb-3 text-xs text-secondary">
              Archived projects are hidden from the sidebar but remain navigable via Activity and
              notifications. They re-appear automatically when new work arrives, or you can restore
              one manually here.
            </p>
            {archivedProjects.length === 0 ? (
              <p className="text-[13px] text-muted">No archived projects.</p>
            ) : (
              <div className="space-y-1">
                {archivedProjects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between rounded-md border border-border bg-tertiary px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-primary truncate">{project.name}</div>
                      <div className="text-[11px] text-muted truncate">{project.path}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onUnarchiveProject(project.id)}
                      disabled={unarchiveProjectPending}
                    >
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="issues">
          <section className="mb-8">
            <p className="mb-3 text-xs text-secondary">
              Archived issues are closed on GitHub and hidden from the board. Restoring brings them
              back locally but does not reopen them on GitHub.
            </p>
            {archivedIssues.length === 0 ? (
              <p className="text-[13px] text-muted">No archived issues.</p>
            ) : (
              <div className="space-y-1">
                {archivedIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="flex items-center justify-between rounded-md border border-border bg-tertiary px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-primary">
                        #{issue.issueNumber} {issue.title}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onUnarchiveIssue(issue.id)}
                      disabled={unarchiveIssuePending}
                    >
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}
