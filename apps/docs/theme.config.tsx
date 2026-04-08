const basePath = process.env.DOCS_BASE_PATH || ''

const config = {
  navbar: (
    <div style={{ fontWeight: 700 }}>
      <a href={basePath || '/'} style={{ color: 'inherit', textDecoration: 'none' }}>
        ShipCode
      </a>
    </div>
  ),
  docsRepositoryBase: 'https://github.com/shipshitdev/shipcode/tree/master/apps/docs',
  footer: <div>ShipCode - Autonomous AI coding pipeline</div>,
  editLink: 'Edit this page',
  feedback: {
    content: 'Question? Give us feedback',
  },
}

export default config
