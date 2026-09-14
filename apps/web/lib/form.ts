/** FormData holds strings and Files. Everything these forms read is a string. */
export function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}
