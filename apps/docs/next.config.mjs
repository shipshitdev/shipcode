import nextra from 'nextra'

const docsBasePath = process.env.DOCS_BASE_PATH || ''
const withNextra = nextra({})

export default withNextra({
  reactStrictMode: true,
  basePath: docsBasePath,
  output: 'export',
})
