import { describe, expect, it } from 'vitest';
import { toSpeakable } from '@/features/assistant/speakable';

describe('toSpeakable (text shown on screen -> text read aloud)', () => {
  it('reads course codes and class codes character by character', () => {
    expect(toSpeakable('Attendance for CSC401 is open. The class code is 482913.'))
      .toBe('Attendance for C S C 4 0 1 is open. The class code is 4 8 2 9 1 3.');
  });
  it('reads reference numbers naturally', () => {
    expect(toSpeakable('Invoice INV-2026-000142 created.')).toBe('Invoice I N V, 2026, 142 created.');
    expect(toSpeakable('Your registration number is AIU-2026-0084.')).toBe('Your registration number is A I U, 2026, 84.');
  });
  it('says money in words', () => {
    expect(toSpeakable('Pay 4,500.00 USD now')).toBe('Pay 4,500 US dollars now');
    expect(toSpeakable('Balance 75.50 USD')).toBe('Balance 75.50 US dollars');
  });
  it('strips markdown and links', () => {
    expect(toSpeakable('**Done** - see https://x.y/z')).toBe('Done - see the link');
  });
});
