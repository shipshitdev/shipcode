CREATE TABLE IF NOT EXISTS issue_edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_issue_id TEXT NOT NULL REFERENCES github_issue_cache(id) ON DELETE CASCADE,
  target_issue_id TEXT NOT NULL REFERENCES github_issue_cache(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,
  origin TEXT NOT NULL,
  source_body_issue_id TEXT REFERENCES github_issue_cache(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_issue_edges_project ON issue_edges(project_id);
CREATE INDEX IF NOT EXISTS idx_issue_edges_source ON issue_edges(source_issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_edges_target ON issue_edges(target_issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_edges_type ON issue_edges(edge_type);
CREATE INDEX IF NOT EXISTS idx_issue_edges_source_body ON issue_edges(source_body_issue_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_edges_unique_manual
  ON issue_edges(project_id, source_issue_id, target_issue_id, edge_type, origin)
  WHERE source_body_issue_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_edges_unique_body
  ON issue_edges(project_id, source_issue_id, target_issue_id, edge_type, origin, source_body_issue_id)
  WHERE source_body_issue_id IS NOT NULL;
