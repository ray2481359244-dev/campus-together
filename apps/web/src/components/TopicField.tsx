import { useId } from 'react';
import { topicNameLimit } from '@campus/contracts';
import type { Category, TopicDTO } from '@campus/contracts';

const examples = { GAME: '星露谷联机', STUDY: '晚间口语练习', COMPETITION: '校园地图设计', OUTDOOR: '周末看海' };
export type TopicSelection = { topicId: string | null; customTopic?: string };

export function TopicField({ category, label, value, topics, selectedName, onChange, error }: {
  category: Category;
  label: string;
  value: TopicSelection;
  topics?: TopicDTO[];
  selectedName?: string;
  onChange: (value: TopicSelection) => void;
  error?: string;
}) {
  const id = useId();
  const selected = topics?.find(topic => topic.id === value.topicId);
  const name = value.topicId ? selected?.name ?? selectedName ?? '' : value.customTopic ?? '';
  const search = !value.topicId ? name.trim().toLowerCase() : '';
  const suggestions = topics?.filter(topic => topic.name.toLowerCase().includes(search)).slice(0, 4) ?? [];

  return <div className="form-field topic-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} value={name} maxLength={topicNameLimit} autoComplete="off" placeholder={'例如：' + examples[category]}
      aria-required="true" aria-invalid={!!error} aria-describedby={id + '-hint' + (error ? ' ' + id + '-error' : '')}
      onChange={event => onChange({ topicId: null, customTopic: event.target.value || undefined })} />
    <span id={id + '-hint'} className="field-note">可以自己写，也可以选用常用主题。最多 {topicNameLimit} 个字。</span>
    {suggestions.length > 0 && <div className="topic-suggestions" role="group" aria-label={'常用' + label}>
      {suggestions.map(topic => <button key={topic.id} type="button" aria-pressed={topic.id === value.topicId}
        onClick={() => onChange({ topicId: topic.id, customTopic: undefined })}>{topic.name}</button>)}
    </div>}
    {error && <span id={id + '-error'} className="field-error" role="alert">{error}</span>}
  </div>;
}
