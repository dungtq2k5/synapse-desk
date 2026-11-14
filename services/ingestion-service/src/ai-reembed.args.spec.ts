import { parseArgs, refuseActive } from './ai-reembed.args';

describe('ai:reembed (unit)', () => {
  it('reads --model, --drop and --services-stopped', () => {
    expect(parseArgs(['--model', 'ollama'])).toEqual({ model: 'ollama' });
    expect(parseArgs(['--model', 'gemini', '--services-stopped'])).toEqual({
      model: 'gemini',
      servicesStopped: true,
    });
    expect(parseArgs(['--drop', 'gemini'])).toEqual({ drop: 'gemini' });
    expect(() => parseArgs(['--model', 'gpt'])).toThrow('gemini or ollama');
    expect(() => parseArgs([])).toThrow('Usage');
  });

  it('refuses the active collection, naming the rule', () => {
    expect(() => refuseActive('ollama', 'ollama', false)).toThrow(
      'Never run ai:reembed against the active collection while the services run',
    );
  });

  it('allows the switch: the pre-fill and the catch-up target the NEW model', () => {
    expect(() => refuseActive('ollama', 'gemini', false)).not.toThrow();
  });

  it('allows a deliberate repair once the services have exited', () => {
    expect(() => refuseActive('gemini', 'gemini', true)).not.toThrow();
  });
});
