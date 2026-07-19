import { describe, expect, it } from 'vitest';
import { DISCORD_CONTENT_MAX_LENGTH, SLACK_CONTENT_MAX_LENGTH } from './messaging.js';

describe('messaging content limits', () => {
  it('exports Discord/Slack hard limits used by validation and runtime nodes', () => {
    expect(DISCORD_CONTENT_MAX_LENGTH).toBe(2000);
    expect(SLACK_CONTENT_MAX_LENGTH).toBe(4000);
  });
});
