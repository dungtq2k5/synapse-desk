import { settingsSections } from './settings-sections';

describe('settingsSections', () => {
  it('lists the sections the codes read, in order', () => {
    expect(
      settingsSections(['department.read', 'user.read']).map((s) => s.href),
    ).toEqual(['/settings/people', '/settings/departments']);
  });

  it('shows a section for any one of its codes', () => {
    expect(settingsSections(['organization.read']).map((s) => s.label)).toEqual(
      ['Organization', 'Webhooks', 'Billing'],
    );
  });

  it('is empty for someone with none', () => {
    expect(settingsSections(['ticket.read'])).toEqual([]);
  });
});
