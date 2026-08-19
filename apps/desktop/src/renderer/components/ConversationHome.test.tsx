// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversationHome } from './ConversationHome';

describe('ConversationHome', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the conversation layout with a disabled composer', () => {
    render(<ConversationHome />);

    expect(screen.getByTestId('conversation-home')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByText('Talk to Claude, Codex, or Grok on an issue.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Select an issue to start a conversation…')).toBeDisabled();
  });
});
