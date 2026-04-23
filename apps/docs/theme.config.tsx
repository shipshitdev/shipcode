import { ShipCodeLogoMark } from '@shipshitdev/ui';
import { Navbar } from 'nextra-theme-docs';

const config = {
  navbar: (
    <Navbar
      logo={
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.7rem',
            fontWeight: 700,
            letterSpacing: '-0.02em',
          }}
        >
          <ShipCodeLogoMark size={28} style={{ display: 'block', flexShrink: 0 }} />
          <span>ShipCode</span>
        </span>
      }
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
