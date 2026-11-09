import { avatarColor } from './health';
type Props = { id: string; name: string; className?: string };

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'GR';
  return (words.length === 1 ? words[0].slice(0, 2) : words.slice(0, 2).map((word) => word[0]).join('')).toUpperCase();
}

export function groupAvatarUrl(id: string, name: string) {
  const background = avatarColor(id);
  const letters = initials(name);
  const fontSize = letters.length > 1 ? 42 : 48;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="${letters}"><circle cx="60" cy="60" r="60" fill="${background}"/><text x="60" y="69" fill="#fff" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle">${letters}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function GroupAvatar({ id, name, className = '' }: Props) {
  return <img className={`group-avatar ${className}`.trim()} src={groupAvatarUrl(id, name)} alt={`${name} group avatar`} />;
}
