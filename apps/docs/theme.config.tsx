import { Navbar } from 'nextra-theme-docs';

const config = {
  navbar: (
    <Navbar
      logo={<span style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>ShipCode</span>}
      projectLink="https://github.com/shipshitdev/shipcode"
    />
  ),
  docsRepositoryBase: 'https://github.com/shipshitdev/shipcode/tree/master/apps/docs',
  editLink: 'Edit this page',
  feedback: {
    content: 'Question? Give us feedback',
  },
  darkMode: true,
};

export default config;
