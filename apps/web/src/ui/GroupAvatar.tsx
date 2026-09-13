type Props = { name: string; className?: string };

const palettes = [
  '#0038A8',
  '#005EAF',
  '#1D4E9E',
  '#183A8C',
];

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'GR';
  return (words.length === 1 ? words[0].slice(0, 2) : words.slice(0, 2).map((word) => word[0]).join('')).toUpperCase();
}

function paletteFor(name: string) {
  const hash = [...name].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 7);
  return palettes[hash % palettes.length];
}

export function groupAvatarUrl(name: string) {
  const background = paletteFor(name);
  const letters = initials(name);
  const fontSize = letters.length > 1 ? 42 : 48;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="${letters}"><circle cx="60" cy="60" r="60" fill="${background}"/><text x="60" y="69" fill="#fff" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle">${letters}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function GroupAvatar({ name, className = '' }: Props) {
  return <img className={`group-avatar ${className}`.trim()} src={groupAvatarUrl(name)} alt={`${name} group avatar`} />;
}
