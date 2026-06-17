export function toPhpString(obj: any, indent: number = 0): string {
  const spaces = ' '.repeat(indent);
  const innerSpaces = ' '.repeat(indent + 4);
  
  if (Array.isArray(obj)) {
    if (obj.length === 0) return 'Array\n' + spaces + '(\n' + spaces + ')';
    const items = obj.map((v, i) => `${innerSpaces}[${i}] => ${toPhpString(v, indent + 4)}`).join('\n');
    return `Array\n${spaces}(\n${items}\n${spaces})`;
  } else if (typeof obj === 'object' && obj !== null) {
    const items = Object.entries(obj).map(([k, v]) => `${innerSpaces}[${k}] => ${toPhpString(v, indent + 4)}`).join('\n');
    return `Array\n${spaces}(\n${items}\n${spaces})`;
  }
  return String(obj);
}
