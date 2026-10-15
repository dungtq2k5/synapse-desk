import { SYSTEM_ROLE_PERMISSIONS, SystemRoleName } from './rbac.config';

/**
 * A system role that may assign tickets can also fill the Assign dialog, which
 * lists the people (`user.read`) and the departments (`department.read`) to
 * assign to. Without them the dialog loads nothing to choose.
 */
describe('system roles that assign tickets', () => {
  const assigning = Object.values(SystemRoleName).filter((role) =>
    SYSTEM_ROLE_PERMISSIONS[role].some((code) =>
      ['ticket.assign', 'ticket.assign.self', 'ticket.reassign'].includes(code),
    ),
  );

  it('there is at least one', () => {
    expect(assigning).toContain(SystemRoleName.SUPPORT_AGENT);
  });

  it.each(assigning)('%s can list people and departments', (role) => {
    expect(SYSTEM_ROLE_PERMISSIONS[role]).toEqual(
      expect.arrayContaining(['user.read', 'department.read']),
    );
  });
});
