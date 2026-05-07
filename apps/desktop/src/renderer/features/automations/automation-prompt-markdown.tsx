import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const AUTOMATION_PROMPT_PROSE_CLASSES =
  'break-words text-[12px] leading-relaxed text-secondary ' +
  '[&_h1]:mb-2 [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:text-primary ' +
  '[&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-[12px] [&_h2]:font-semibold [&_h2]:text-primary ' +
  '[&_p]:mb-2 [&_p:last-child]:mb-0 ' +
  '[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-4 ' +
  '[&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-4 ' +
  '[&_li]:mb-0.5 [&_code]:rounded [&_code]:bg-tertiary [&_code]:px-1 [&_code]:font-mono [&_code]:text-[11px]';

export function AutomationPromptMarkdown({ prompt }: { prompt: string }) {
  return (
    <div className={AUTOMATION_PROMPT_PROSE_CLASSES}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{prompt}</ReactMarkdown>
    </div>
  );
}
