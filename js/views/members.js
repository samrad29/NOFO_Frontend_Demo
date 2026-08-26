import { h, viewHead, sectionLabel, note, card, table, tag, toast, idCell, miniButton, shorten } from '../dom.js';
import { setCtx, getCtx, getToken } from '../store.js';
import * as api from '../api.js';

export function render(root) {
  root.append(viewHead(
    'Members & invites',
    'Who is in a workspace, who has been asked, and the role changes in between.',
  ));

  root.append(note(
    'Invites are redeemed by token, not by email address, so you can test the whole loop from one account: ' +
    'create an invite, copy the token, then accept it from a second account signed in on another browser profile.',
  ));

  /* ---------------- roster ---------------- */

  root.append(sectionLabel('Roster'));

  const rosterCard = card({
    method: 'GET',
    path: '/api/teams/:team_id/roster',
    title: 'members and outstanding invites together',
    open: true,
    action: 'Load roster',
    fields: [{ name: 'team_id', label: 'team_id', type: 'number', required: true, ctxKey: 'teamId' }],
    run: async (v, result) => {
      if (!v.team_id) { result.message('team_id is required.', true); return; }
      const res = await api.get(`/api/teams/${v.team_id}/roster`);
      if (!res.ok) { result.render(res); return; }
      const rows = res.data || [];

      result.custom(
        h('div', { class: 'result-head' },
          h('span', { class: 'status ok', text: res.status }),
          h('span', { class: 'result-meta', text: `${rows.length} row(s) · ${res.ms} ms` })),
        table([
          { label: 'state', render: (r) => tag(r.state || '—', r.state === 'member') },
          { label: 'who', render: (r) => h('div', {},
            h('div', { text: r.display_name || r.invited_email || '—' }),
            h('div', { class: 'result-meta', text: [r.title, r.email].filter(Boolean).join(' · ') })) },
          { label: 'role', render: (r) => tag(r.role || '—', r.role === 'owner') },
          { label: 'since', cls: 'mono', render: (r) => (r.since ? String(r.since).slice(0, 10) : '—') },
          { label: 'user_id', cls: 'mono', render: (r) => (r.user_id ? idCell(r.user_id, 'userId', shorten(r.user_id, 8)) : '—') },
          { label: '', render: (r) => {
            if (!r.user_id) return '—';
            const promote = r.role === 'member'
              ? miniButton('→ admin', async () => {
                const res2 = await api.patch(`/api/teams/${v.team_id}/members/${r.user_id}`, { role: 'admin' });
                toast(res2.ok ? 'Promoted to admin' : res2.error, !res2.ok);
                if (res2.ok) rosterCard.cardApi.trigger();
              })
              : r.role === 'admin'
                ? miniButton('→ member', async () => {
                  const res2 = await api.patch(`/api/teams/${v.team_id}/members/${r.user_id}`, { role: 'member' });
                  toast(res2.ok ? 'Demoted to member' : res2.error, !res2.ok);
                  if (res2.ok) rosterCard.cardApi.trigger();
                })
                : null;
            const remove = r.role === 'owner' ? null : miniButton('remove', async () => {
              if (!confirm(`Remove ${r.display_name || r.email || r.user_id} from team ${v.team_id}?`)) return;
              const res2 = await api.del(`/api/teams/${v.team_id}/members/${r.user_id}`);
              toast(res2.ok ? 'Removed' : res2.error, !res2.ok);
              if (res2.ok) rosterCard.cardApi.trigger();
            });
            return h('div', { class: 'cell-actions' }, promote, remove);
          } },
        ], rows, { empty: 'No members or invites.' }),
        rows.some((r) => r.state === 'invited' || r.state === 'expired')
          ? h('div', { class: 'note', style: 'margin-top:9px', html:
            'The roster does not carry <code>invite_id</code>, so pending invites cannot be revoked from this ' +
            'table. Use the revoke card at the bottom with the id returned when the invite was created.' })
          : null,
      );
    },
  });
  root.append(rosterCard);

  /* ---------------- role changes ---------------- */

  root.append(sectionLabel('Roles'));

  root.append(card({
    method: 'PATCH',
    path: '/api/teams/:team_id/members/:user_id',
    title: 'promote or demote',
    desc: 'Admins and owners only. The owner’s role cannot be changed this way — use transfer.',
    action: 'Set role',
    fields: [
      { name: 'team_id', label: 'team_id', type: 'number', required: true, ctxKey: 'teamId' },
      { name: 'user_id', label: 'user_id', required: true, ctxKey: 'userId', placeholder: 'uuid' },
      { name: 'role', label: 'role', type: 'select', options: ['admin', 'member'] },
    ],
    run: async (v, result) => {
      if (!v.team_id || !v.user_id) { result.message('team_id and user_id are both required.', true); return; }
      const res = await api.patch(`/api/teams/${v.team_id}/members/${v.user_id.trim()}`, { role: v.role });
      result.render(res);
      if (res.ok) toast('Role set to ' + v.role);
    },
  }));

  root.append(card({
    method: 'DELETE',
    path: '/api/teams/:team_id/members/:user_id',
    title: 'remove a member, or leave',
    desc: 'Passing your own user_id is how you leave a workspace.',
    action: 'Remove',
    fields: [
      { name: 'team_id', label: 'team_id', type: 'number', required: true, ctxKey: 'teamId' },
      { name: 'user_id', label: 'user_id', required: true, ctxKey: 'userId' },
    ],
    run: async (v, result) => {
      if (!v.team_id || !v.user_id) { result.message('team_id and user_id are both required.', true); return; }
      if (!confirm(`Remove ${v.user_id} from team ${v.team_id}?`)) return;
      const res = await api.del(`/api/teams/${v.team_id}/members/${v.user_id.trim()}`);
      result.render(res);
      if (res.ok) toast('Member removed');
    },
  }));

  root.append(card({
    method: 'POST',
    path: '/api/teams/:team_id/transfer',
    title: 'hand over ownership',
    desc: 'Owner only, and the recipient must already be an admin on the team.',
    action: 'Transfer ownership',
    fields: [
      { name: 'team_id', label: 'team_id', type: 'number', required: true, ctxKey: 'teamId' },
      { name: 'user_id', label: 'user_id', required: true, ctxKey: 'userId', hint: 'Must be an existing admin.' },
    ],
    run: async (v, result) => {
      if (!v.team_id || !v.user_id) { result.message('team_id and user_id are both required.', true); return; }
      if (!confirm(`Transfer ownership of team ${v.team_id} to ${v.user_id}? You will become an admin.`)) return;
      const res = await api.post(`/api/teams/${v.team_id}/transfer`, { user_id: v.user_id.trim() });
      result.render(res);
      if (res.ok) toast('Ownership transferred');
    },
  }));

  /* ---------------- invites ---------------- */

  root.append(sectionLabel('Invites'));

  const acceptCard = card({
    method: 'POST',
    path: '/api/invites/accept',
    title: 'redeem an invite token',
    desc: 'Call this as the invited user. The token is the credential, so it works regardless of which email is signed in.',
    action: 'Accept invite',
    fields: [{ name: 'token', label: 'token', wide: true, required: true }],
    run: async (v, result) => {
      if (!v.token.trim()) { result.message('token is required.', true); return; }
      const res = await api.post('/api/invites/accept', { token: v.token.trim() });
      result.render(res);
      if (res.ok) {
        if (res.data?.team_id) setCtx('teamId', res.data.team_id);
        toast(`Joined ${res.data?.team_name || 'team'} as ${res.data?.role}`);
      } else if (res.status === 410) {
        toast('That invite is expired or already used (410)', true);
      }
    },
  });

  root.append(card({
    method: 'POST',
    path: '/api/teams/:team_id/invites',
    title: 'invite someone by email',
    desc: 'Admins and owners only. Returns the invite_id and the token; the token is what the invitee redeems.',
    action: 'Send invite',
    fields: [
      { name: 'team_id', label: 'team_id', type: 'number', required: true, ctxKey: 'teamId' },
      { name: 'email', label: 'email', type: 'email', required: true },
      { name: 'role', label: 'role', type: 'select', options: ['member', 'admin'] },
      { name: 'message', label: 'message', wide: true },
    ],
    run: async (v, result) => {
      if (!v.team_id || !v.email.trim()) { result.message('team_id and email are both required.', true); return; }
      const body = { email: v.email.trim(), role: v.role };
      if (v.message.trim()) body.message = v.message.trim();
      const res = await api.post(`/api/teams/${v.team_id}/invites`, body);
      result.render(res);

      if (res.ok && res.data?.token) {
        setCtx('inviteId', res.data.invite_id);
        acceptCard.cardApi.field('token').set(res.data.token);
        result.setBody(
          h('pre', { class: 'json', text: JSON.stringify(res.data, null, 2) }),
          h('div', { class: 'note', style: 'margin-top:9px', html:
            `Token copied into the <b>accept</b> card below, and <code>invite_id ${res.data.invite_id}</code> ` +
            'is now the active invite.' }),
        );
        toast('Invite created — token filled in below');
      } else if (res.status === 409) {
        toast('That email already has a pending invite (409)', true);
      }
    },
  }));

  root.append(acceptCard);

  root.append(card({
    method: 'DELETE',
    path: '/api/invites/:invite_id',
    title: 'revoke an unaccepted invite',
    desc: 'Admins only.',
    action: 'Revoke',
    fields: [{ name: 'invite_id', label: 'invite_id', type: 'number', required: true, ctxKey: 'inviteId' }],
    run: async (v, result) => {
      if (!v.invite_id) { result.message('invite_id is required.', true); return; }
      const res = await api.del(`/api/invites/${v.invite_id}`);
      result.render(res);
      if (res.ok) toast('Invite revoked');
    },
  }));

  // Only auto-load when there is a team to load; otherwise it just errors.
  if (getToken() && getCtx('teamId')) requestAnimationFrame(() => rosterCard.cardApi.trigger());
}
