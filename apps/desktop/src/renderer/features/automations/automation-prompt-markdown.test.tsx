// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AutomationPromptMarkdown } from './automation-prompt-markdown';

describe('AutomationPromptMarkdown', () => {
  it('renders markdown prompts with GitHub-flavored markdown support', () => {
    render(<AutomationPromptMarkdown prompt={'## Ship it\n\n- [x] covered `code`'} />);

    expect(screen.getByRole('heading', { name: 'Ship it' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByText('code')).toBeInTheDocument();
  });
});
