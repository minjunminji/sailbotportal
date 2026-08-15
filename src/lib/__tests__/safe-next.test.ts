import { safeNextPath } from '../safe-next';

describe('safeNextPath', () => {
  it('keeps a relative path', () => {
    expect(safeNextPath('/admin/soft')).toBe('/admin/soft');
    expect(safeNextPath('/admin?tab=open')).toBe('/admin?tab=open');
  });

  it('falls back when the parameter is absent or empty', () => {
    expect(safeNextPath(null)).toBe('/admin');
    expect(safeNextPath(undefined)).toBe('/admin');
    expect(safeNextPath('')).toBe('/admin');
  });

  it('rejects absolute URLs on another origin', () => {
    expect(safeNextPath('https://evil.example')).toBe('/admin');
    expect(safeNextPath('http://evil.example/admin')).toBe('/admin');
  });

  it('rejects protocol-relative URLs', () => {
    expect(safeNextPath('//evil.example')).toBe('/admin');
    expect(safeNextPath('/\\evil.example')).toBe('/admin');
  });

  it('rejects schemes and smuggled control characters', () => {
    expect(safeNextPath('javascript:alert(1)')).toBe('/admin');
    expect(safeNextPath('/\tjavascript:alert(1)')).toBe('/admin');
    expect(safeNextPath('/admin\nSet-Cookie: x=1')).toBe('/admin');
  });

  it('rejects a repeated parameter, which arrives as an array', () => {
    expect(safeNextPath(['/admin', 'https://evil.example'])).toBe('/admin');
  });
});
