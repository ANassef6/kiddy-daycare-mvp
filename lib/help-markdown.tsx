// KID-260: a small renderer for the Help Center article bodies.
//
// The Notion export uses a deliberately small markdown subset: bold spans,
// inline code, hash headings, `1.` / Arabic-Indic numbered steps, `- ` bullet
// lists, and blank-line-separated paragraphs. Quotes, tables and images do not
// appear in the corpus; unknown syntax degrades to plain text lines.
import type { ReactNode } from "react";

const NUMBERED = /^(?:\d{1,2}|[\u0660-\u0669]{1,3}|[\u06F0-\u06F9]{1,3})[.)]\s+/;
const BULLETED = /^[-*]\s+/;
const HEADING = /^#+\s+/;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g;
  let lastIndex = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    index += 1;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(
        <a key={key} href={token} target="_blank" rel="noopener noreferrer">
          {token}
        </a>,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function helpMarkdownBlocks(body: string): { type: "p" | "ol" | "ul" | "h"; lines: string[] }[] {
  const blocks: { type: "p" | "ol" | "ul" | "h"; lines: string[] }[] = [];
  for (const rawLine of String(body ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const type = line.startsWith("#") ? "h" : NUMBERED.test(line) ? "ol" : BULLETED.test(line) ? "ul" : "p";
    const last = blocks[blocks.length - 1];
    if (last && last.type === type) last.lines.push(line);
    else blocks.push({ type, lines: [line] });
  }
  return blocks;
}

export function HelpArticleBody({ body, dir }: { body: string; dir: "ltr" | "rtl" }) {
  const blocks = helpMarkdownBlocks(body);
  return (
    <div className="help-article-body" dir={dir}>
      {blocks.map((block, blockIndex) => {
        const textOf = (line: string) =>
          line.replace(HEADING, "").replace(NUMBERED, "").replace(BULLETED, "");
        if (block.type === "ol" || block.type === "ul") {
          return (
            <ol key={blockIndex}>
              {block.lines.map((line, lineIndex) => (
                <li key={lineIndex}>{inline(textOf(line), `${blockIndex}-${lineIndex}`)}</li>
              ))}
            </ol>
          );
        }
        const text = block.lines.map(textOf).join(" ");
        if (block.type === "h") {
          return <h3 key={blockIndex}>{text}</h3>;
        }
        return <p key={blockIndex}>{inline(text, `${blockIndex}`)}</p>;
      })}
    </div>
  );
}
