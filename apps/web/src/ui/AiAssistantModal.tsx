import { type FormEvent, useEffect, useRef, useState } from 'react';
import { request } from '../api';
import { MarkdownText } from './MarkdownText';

type Message = { role: 'user' | 'assistant'; content: string; refused?: boolean };

const quickActions = [
  { label: 'Generate 10 Ideas', prompt: 'Generate 10 academic project ideas for my course.' },
  { label: 'Idea Voting Guide', prompt: 'Explain how idea voting and converting a winning idea into a project works.' },
  { label: 'External Tools', prompt: 'What external tools does WebSphere support and how do I connect one to my project?' },
  { label: 'Capstone Ideas', prompt: 'Suggest capstone project ideas suitable for a computer science course.' },
  { label: 'Workflow Planning', prompt: 'Help me plan a workflow and task breakdown for my project.' },
];

export type AiAssistant = {
  messages: Message[];
  prompt: string;
  setPrompt: (value: string) => void;
  busy: boolean;
  send: (text: string) => void;
};

/**
 * Owns the assistant conversation outside the modal view so a request keeps running — and its
 * result is still captured — while the panel is minimized or the user navigates to another page.
 * Living in a parent that stays mounted (the Workspace) is what makes "minimize while processing"
 * work: the modal is just a view over this state.
 */
export function useAiAssistant(notify: (message: string) => void): AiAssistant {
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  function send(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    setMessages((current) => [...current, { role: 'user', content: value }]);
    setPrompt('');
    setBusy(true);
    // Fire-and-forget: the promise is owned by this hook (which outlives the modal view), so
    // minimizing or navigating never cancels the request or drops its response.
    void (async () => {
      try {
        const result = await request<{ response: string; refused?: boolean }>('/ai/ask', { method: 'POST', body: JSON.stringify({ prompt: value }) });
        setMessages((current) => [...current, { role: 'assistant', content: result.response, refused: result.refused }]);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'WebSphere AI is unavailable right now.';
        setMessages((current) => [...current, { role: 'assistant', content: message, refused: true }]);
        notify(message);
      } finally {
        setBusy(false);
      }
    })();
  }

  return { messages, prompt, setPrompt, busy, send };
}

type Props = {
  open: boolean;
  minimized: boolean;
  assistant: AiAssistant;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
};

export function AiAssistantModal({ open, minimized, assistant, onClose, onMinimize, onRestore }: Props) {
  const { messages, prompt, setPrompt, busy, send } = assistant;
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { if (open && !minimized) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy, open, minimized]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(prompt);
  }

  // Minimized: collapse to an unobtrusive floating pill that still signals progress and, when the
  // response is ready, surfaces an unread dot so the user knows to reopen.
  if (open && minimized) {
    const lastMessage = messages[messages.length - 1];
    const hasReply = !busy && lastMessage?.role === 'assistant';
    return <button type="button" className="ai-mini-pill" onClick={onRestore} aria-label="Reopen WebSphere AI Assistant">
      <span className="ai-mini-icon">✦</span>
      <span className="ai-mini-text">{busy ? 'WebSphere AI is working…' : 'WebSphere AI Assistant'}</span>
      {busy ? <span className="ai-mini-spinner" aria-hidden="true" /> : hasReply ? <span className="ai-mini-dot" aria-hidden="true" /> : null}
    </button>;
  }

  if (!open) return null;
  return <div className="ai-modal-ov" onMouseDown={(event) => { if (event.target === event.currentTarget) onMinimize(); }}>
    <div className="ai-modal-box">
      <div className="ai-modal-header">
        <span className="ai-modal-icon">✦</span>
        <div className="ai-modal-title"><strong>WebSphere AI Assistant</strong><small>Academic Project Intelligence</small></div>
        <div className="ai-modal-actions">
          <button type="button" title="Minimize" aria-label="Minimize assistant" onClick={onMinimize}>–</button>
          <button type="button" title="Close" aria-label="Close assistant" onClick={onClose}>×</button>
        </div>
      </div>
      <div className="ai-modal-body">
          <div className="ai-modal-msg assistant">
            <p>Hello. I am <strong>WebSphere AI</strong>, your academic project planning assistant. Before creating a project, I help you and your group <strong>generate and vote on project ideas</strong> to find the best one.</p>
            <ul>
              <li><strong>Generate Project Ideas</strong> — AI suggests ideas based on your course/category</li>
              <li><strong>Idea Voting System</strong> — Group members can react and vote on ideas; highest-voted idea gets selected</li>
              <li><strong>Features &amp; Functionalities</strong> — Practical and realistic recommendations</li>
              <li><strong>External Tools &amp; Platforms</strong> — Matched to your specific project</li>
              <li><strong>Workflow &amp; Academic Planning</strong> — For individual and group projects</li>
            </ul>
            <span className="ai-modal-meta">WebSphere AI · just now</span>
          </div>
          {messages.map((message, index) => <div className={`ai-modal-msg ${message.role} ${message.refused ? 'refused' : ''}`} key={index}>
            {message.role === 'assistant' ? <MarkdownText source={message.content} /> : <p>{message.content}</p>}
          </div>)}
          {busy ? <div className="ai-modal-msg assistant typing"><span className="ai-typing-dot" /><span className="ai-typing-dot" /><span className="ai-typing-dot" /></div> : null}
          <div ref={bottomRef} />
      </div>
      <div className="ai-modal-quick">{quickActions.map((action) => <button key={action.label} type="button" disabled={busy} onClick={() => send(action.prompt)}>{action.label}</button>)}</div>
      <form className="ai-modal-inputrow" onSubmit={onSubmit}>
        <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask about project titles, thesis topics, tools, or academic planning…" disabled={busy} />
        <button type="submit" disabled={busy || !prompt.trim()} aria-label="Send"><SendIcon /></button>
      </form>
    </div>
  </div>;
}

function SendIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>;
}
