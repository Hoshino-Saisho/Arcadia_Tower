import { describeSkill, describeSkillTrigger } from '../../core/describe';
import type { SkillDef } from '../../core/types';

/** 技能说明卡片（图鉴、角色设定、编辑器预览共用；说明文字由数据自动生成） */
export function SkillCard({
  skill,
  selected,
  onClick,
  disabled,
  badge,
}: {
  skill: SkillDef;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
}) {
  const body = (
    <>
      <div className="skill-card-head">
        <span className="skill-dot" style={{ background: skill.color }} />
        <strong>{skill.name}</strong>
        <span className="muted small mono">{skill.id}</span>
        {badge && <span className="badge">{badge}</span>}
      </div>
      <div className="skill-card-trigger">{describeSkillTrigger(skill)}</div>
      <ul className="skill-card-effects">
        {describeSkill(skill).map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {skill.description && <div className="skill-card-desc">{skill.description}</div>}
    </>
  );
  if (!onClick) return <div className="skill-card" style={{ borderLeftColor: skill.color }}>{body}</div>;
  return (
    <button
      type="button"
      className={`skill-card selectable${selected ? ' selected' : ''}`}
      style={{ borderLeftColor: skill.color }}
      onClick={onClick}
      disabled={disabled}
    >
      {body}
    </button>
  );
}
