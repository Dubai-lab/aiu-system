/**
 * Turn the assistant's on-screen text into something that sounds right when read
 * aloud (spec 13.2: "strip any markdown/symbols before speaking").
 * The screen shows CSC401 / INV-2026-000142 / 482913; the voice says
 * "C S C 4 0 1", "I N V 2026 142", "4 8 2 9 1 3".
 */

const spell = (s: string) => s.split('').join(' ');

export function toSpeakable(text: string): string {
  return (
    text
      // markdown and symbols
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*_`#>|~]+/g, ' ')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/https?:\/\/\S+/g, 'the link')
      // money: "4,500.00 USD" -> "4,500 US dollars"
      .replace(/(\d[\d,]*)\.00\s*USD\b/g, '$1 US dollars')
      .replace(/(\d[\d,]*(?:\.\d{2})?)\s*USD\b/g, '$1 US dollars')
      .replace(/\bUSD\b/g, 'US dollars')
      // reference numbers: AIU-2026-0084, INV-2026-000142, PAY-2026-000087
      .replace(/\b([A-Z]{2,4})-(\d{4})-(\d{3,6})\b/g, (_, prefix: string, year: string, n: string) =>
        `${spell(prefix)}, ${year}, ${String(Number(n))}`)
      // course codes: CSC401 -> C S C 4 0 1
      .replace(/\b([A-Z]{2,6})(\d{3})\b/g, (_, letters: string, digits: string) => `${spell(letters)} ${spell(digits)}`)
      // 6-digit class codes, read digit by digit
      .replace(/\b(\d{6})\b/g, (_, digits: string) => spell(digits))
      .replace(/\s+/g, ' ')
      .trim()
  );
}
