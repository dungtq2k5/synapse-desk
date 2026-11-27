import { clientIp } from './client-ip';

describe('clientIp', () => {
  it.each([
    [
      'the rightmost entry, the one the trusted hop appended',
      '198.51.100.7, 203.0.113.9',
      '203.0.113.9',
    ],
    ['a single entry', '203.0.113.9', '203.0.113.9'],
    ['the rightmost non-blank entry', '203.0.113.9, ', '203.0.113.9'],
    [
      'repeated headers, joined',
      ['198.51.100.7', '203.0.113.9'],
      '203.0.113.9',
    ],
    ['the peer, with no header', undefined, '10.0.0.5'],
    ['the peer, with a blank header', ' , ', '10.0.0.5'],
  ])('reads %s', (_title, forwardedFor, ip) => {
    expect(clientIp(forwardedFor, '10.0.0.5')).toBe(ip);
  });

  it('is empty with neither', () => {
    expect(clientIp(undefined, undefined)).toBe('');
  });
});
