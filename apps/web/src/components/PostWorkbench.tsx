import type { ReactNode } from 'react';
import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageSquare, Flag, FileText, ArrowUpRight, Link2 } from 'lucide-react';
import { SectionLink } from './UI';
import { useVisualPreferences } from '../lib/visual-preferences';
import { WorkbenchMotionContext } from '../lib/workbench-motion';

type View = 'read' | 'talk' | 'act';
type Props = {
  heading: ReactNode;
  body: ReactNode;
  summary: ReactNode;
  feedback: ReactNode;
  discussion: ReactNode;
  actions: ReactNode;
  commentCount: number | null;
  teamCount: number | null;
};

export function PostWorkbench({ heading, body, summary, feedback, discussion, actions, commentCount, teamCount }: Props) {
  const location = useLocation();
  const { motionEnabled } = useVisualPreferences();
  const layout = useRef<HTMLDivElement>(null);
  const hash = location.hash.slice(1);
  const view: View = hash === 'linked-recruitments' ? 'act' : hash === 'post-content' ? 'read'
    : hash === 'conversation' || hash === 'write-comment' || new URLSearchParams(location.search).has('comment') ? 'talk' : 'read';
  const previous = useRef(view);
  const scrollOffsets = useRef<Partial<Record<View, number>>>({});
  const transition = useRef<{ target: string; rects: Map<HTMLElement, DOMRect> } | null>(null);
  const animations = useRef<Animation[]>([]);
  const cards = () => Array.from(layout.current?.querySelectorAll<HTMLElement>('.wb-source,.wb-talk,.wb-act') ?? []);
  const scrollHost = () => layout.current?.closest<HTMLElement>('#main-content');
  const clearAnimations = () => {
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
  };
  function capture(target: string) {
    const group = layout.current?.querySelector<HTMLElement>('.wb-responses');
    const host = scrollHost();
    if (view !== 'read' && group && host) {
      const margin = parseFloat(getComputedStyle(group).scrollMarginTop) + parseFloat(getComputedStyle(host).scrollPaddingTop);
      const top = group.getBoundingClientRect().top;
      scrollOffsets.current[view] = Math.max(0, host.getBoundingClientRect().top + margin - top);
    }
    transition.current = { target, rects: new Map(motionEnabled ? cards().map(node => [node, node.getBoundingClientRect()]) : []) };
    clearAnimations();
  }
  useLayoutEffect(() => {
    if (!motionEnabled) clearAnimations();
  }, [motionEnabled]);
  useLayoutEffect(() => {
    const pending = transition.current;
    const changed = previous.current !== view;
    previous.current = view;
    transition.current = null;
    if (!pending) {
      // Direct links also land on the selected panel. Targeted comments manage their own focus.
      if ((view === 'act' || view === 'talk' && hash !== 'write-comment') && !new URLSearchParams(location.search).has('comment')) {
        layout.current?.querySelector('.wb-responses')?.scrollIntoView({ block: 'start', behavior: 'instant' });
      } else if (hash === 'post-content' || hash === 'write-comment') {
        document.getElementById(hash)?.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
      return;
    }
    const target = layout.current?.querySelector<HTMLElement>(pending.target === 'conversation' ? '#wb-talk-title'
      : pending.target === 'linked-recruitments' ? '#wb-act-title'
      : pending.target === 'write-comment' ? '#comment-body' : '.wb-source h1');
    target?.focus({ preventScroll: true });
    const anchor = changed && view !== 'read' ? layout.current?.querySelector('.wb-responses') : target;
    anchor?.scrollIntoView({ block: 'start', behavior: 'instant' });
    const offset = pending.target === 'conversation' || pending.target === 'linked-recruitments' ? scrollOffsets.current[view] : 0;
    if (offset && changed) {
      const host = scrollHost();
      host?.scrollBy({ top: offset, behavior: 'instant' });
      if (target && host && target.getBoundingClientRect().bottom < host.getBoundingClientRect().top) {
        const control = layout.current?.querySelector<HTMLElement>('.wb-nav [aria-current]');
        control?.focus({ preventScroll: true });
      }
    }
    if (!motionEnabled || !changed) return;
    for (const node of cards()) {
      const first = pending.rects.get(node), last = node.getBoundingClientRect();
      if (!first || !last.width || !last.height) continue;
      const origin = `translate(${first.left - last.left}px,${first.top - last.top}px) scale(${first.width / last.width},${first.height / last.height})`;
      const animation = node.animate([{ transform: origin, transformOrigin: 'top left' }, { transform: 'none', transformOrigin: 'top left' }], {
        duration: 340, easing: 'cubic-bezier(.2,.85,.2,1)',
      });
      animations.current.push(animation);
    }
  }, [location.key, location.search, hash, view, motionEnabled]);
  useLayoutEffect(() => clearAnimations, []);

  const talk = <ResponseCard key="talk" kind="talk" compact={view === 'act'} expanded={view === 'talk'} title="评论互动" count={commentCount}
    description={commentCount === 0 ? '欢迎留下第一条评论' : '看看大家怎么说'} preview="展开这场讨论">
    <p className="surface-origin"><Link2 size={14} aria-hidden="true" />正在回应这篇原帖</p>{discussion}
  </ResponseCard>;
  const act = <ResponseCard key="act" kind="act" compact={view === 'talk'} expanded={view === 'act'} title="相关招募" count={teamCount}
    description={teamCount === 0 ? '暂无招募，可发起一条' : '看看谁想一起做'} preview="把下一步展开">{actions}</ResponseCard>;
  return <WorkbenchMotionContext value={capture}>
    <div className="post-workbench post-detail" data-view={view} ref={layout}>
      <nav className="post-section-nav wb-nav" aria-label="帖子内容导航">
        <SectionLink target="post-content" active={view === 'read'}><FileText size={16} aria-hidden="true" />01 帖子正文</SectionLink>
        <SectionLink target="conversation" active={view === 'talk'}><MessageSquare size={16} aria-hidden="true" />02 评论互动 <span aria-hidden="true">{commentCount ?? '…'}</span></SectionLink>
        <SectionLink target="linked-recruitments" active={view === 'act'}><Flag size={16} aria-hidden="true" />03 相关招募 <span aria-hidden="true">{teamCount ?? '…'}</span></SectionLink>
      </nav>
      <div className="wb-layout">
        <article className="wb-source paper">
          <div className="surface-caption"><FileText size={17} aria-hidden="true" />想法的起点<span>原帖</span></div>
          {heading}
          <div className="wb-source-body" hidden={view !== 'read'}>{body}</div>
          <div className="wb-source-summary" hidden={view === 'read'}>{summary}<SectionLink target="post-content" className="text-button">展开完整原帖<ArrowUpRight size={16} aria-hidden="true" /></SectionLink></div>
          <div className="wb-feedback">{feedback}</div>
        </article>
        <div className="wb-continuation" aria-hidden="true"><i /><span>由此延伸</span><i /></div>
        <div className="wb-responses">{view === 'talk' ? [act, talk] : [talk, act]}</div>
      </div>
    </div>
  </WorkbenchMotionContext>;
}

function ResponseCard({ kind, compact, expanded, title, count, description, preview, children }: {
  kind: 'talk' | 'act'; compact: boolean; expanded: boolean; title: string;
  count: number | null; description: string; preview: string; children: ReactNode;
}) {
  const Icon = kind === 'talk' ? MessageSquare : Flag;
  const target = kind === 'talk' ? 'conversation' : 'linked-recruitments';
  const titleId = 'wb-' + kind + '-title';
  return <section className={kind === 'talk' ? 'wb-talk surface-talk' : 'wb-act surface-action'} data-compact={compact}
    aria-label={compact ? title : undefined} aria-labelledby={compact ? undefined : titleId}>
    <div hidden={compact}>
      <header className="surface-heading"><Icon size={23} aria-hidden="true" /><div>
        <h2 id={titleId} tabIndex={-1}>{title}</h2>
        <p>{count === null ? description : kind === 'talk' ? `${count} 条评论` : `${count} 条招募`}</p>
      </div></header>
      {!expanded && <div className="wb-preview">
        <p>{description}</p><SectionLink target={target} className="text-button">{preview}<ArrowUpRight size={17} aria-hidden="true" /></SectionLink>
      </div>}
    </div>
    {compact && <SectionLink target={target} className="wb-compact-link">
      <Icon size={20} aria-hidden="true" /><span><strong>{title}{count !== null && ` · ${count}`}</strong><small>{description}</small></span><ArrowUpRight size={17} aria-hidden="true" />
    </SectionLink>}
    <div hidden={!expanded}>{children}</div>
  </section>;
}
