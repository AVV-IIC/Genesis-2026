import { $, $$, api, html, raw, setHTML, icon, toast, toastError, timeAgo, withBusy, TICKET_LABEL } from '../core.js';
import { chip, empty } from './shared.js';

const state = { filter: 'active' };

const QUICK_REPLIES = [
  'On it. Someone from the team is heading to your table now.',
  'A mentor will reach you in about 10 minutes.',
  'Fixed on our side. Can you check again and let us know?',
  'Please come to the help desk and we’ll sort it out in person.',
];

export function onEvent(type, data, ctx) {
  if (type === 'ticket' || type === 'teams') {
    ctx.rerender();
    return true;
  }
  return false;
}

export async function render(ctx, params, seq) {
  const id = Number(params[0]) || null;
  const [{ tickets }, detail] = await Promise.all([api('/admin/tickets'), id ? api(`/admin/tickets/${id}`) : Promise.resolve(null)]);
  if (!ctx.isCurrent(seq)) return;
  const ticket = detail ? detail.ticket : null;
  if (ticket) {
    const listed = tickets.find((t) => t.id === ticket.id);
    if (listed && listed.admin_unread) {
      listed.admin_unread = false;
      ctx.refreshMeta().catch(() => {});
    }
  }

  const counts = {
    active: tickets.filter((t) => t.status !== 'resolved').length,
    open: tickets.filter((t) => t.status === 'open').length,
    in_progress: tickets.filter((t) => t.status === 'in_progress').length,
    resolved: tickets.filter((t) => t.status === 'resolved').length,
    all: tickets.length,
  };
  const shown = tickets.filter((t) => state.filter === 'all' || (state.filter === 'active' ? t.status !== 'resolved' : t.status === state.filter));

  setHTML(
    ctx.main,
    html`
    <div class="page-head"><div><h1 class="page-title">Help desk</h1><p>Requests from team leaders. Replying marks a request “In progress” and notifies the team.</p></div></div>
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Filter requests">
        ${[['active', 'Needs attention'], ['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved'], ['all', 'All']].map(
          ([k, label]) => html`<button type="button" data-filter="${k}" aria-pressed="${state.filter === k}">${label} <span class="faint">${counts[k]}</span></button>`
        )}
      </div>
    </div>
    <div class="help-grid">
      <section class="card card-flush">
        ${shown.length
          ? html`<div class="ticket-list">${shown.map(
              (t) => html`<a class="ticket-row${t.admin_unread ? ' is-unread' : ''}" href="#/help/${t.id}" ${ticket && ticket.id === t.id ? raw('aria-current="true"') : ''}>
                <strong>${t.subject}</strong>${chip(t.status, TICKET_LABEL[t.status])}
                <small>${t.team_name}${t.table_no ? ` · T${t.table_no}` : ''} · ${t.category} · ${timeAgo(t.updated_at)}</small></a>`
            )}</div>`
          : empty(state.filter === 'active' ? 'All caught up' : 'Nothing here', state.filter === 'active' ? 'No requests need attention right now.' : 'No requests match this filter.')}
      </section>
      <section>${ticket ? threadCard(ticket) : html`<div class="card">${empty('Pick a request', 'Choose a request on the left to read it and reply.')}</div>`}</section>
    </div>`
  );

  $$('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      ctx.rerender();
    })
  );
  if (ticket) bindThread(ctx, ticket);
}

function threadCard(t) {
  return html`<div class="card stack">
    <div class="row-between" style="align-items:start">
      <div><h2 class="section-title">${t.subject}</h2>
        <p class="small muted" style="margin-top:6px"><span class="code-tag">${t.team_code}</span> ${t.team_name}${t.table_no ? ` · Table ${t.table_no}` : ''} · ${t.category} · opened ${timeAgo(t.created_at)}</p></div>
      <label class="field"><span class="sr-only">Status</span>
        <select class="select" id="tk-status" style="min-width:150px">${Object.entries(TICKET_LABEL).map(([k, v]) => html`<option value="${k}" ${k === t.status ? raw('selected') : ''}>${v}</option>`)}</select></label>
    </div>
    <div class="thread">${t.messages.map(
      (m) => html`<div class="msg ${m.author_type === 'admin' ? 'mine' : ''}"><p>${m.body}</p><small>${m.author_type === 'team' ? `${m.author_name} (team leader)` : m.author_name} · ${timeAgo(m.created_at)}</small></div>`
    )}</div>
    <form class="stack-sm" id="tk-reply" novalidate>
      <div class="row">${QUICK_REPLIES.map((q, i) => html`<button type="button" class="btn btn-sm btn-ghost" data-quick="${i}" title="${q}">${q.split(/[.,]/)[0]}</button>`)}</div>
      <label class="field"><span>Reply to ${t.team_name}</span><textarea class="textarea" id="tk-msg-${t.id}" maxlength="3000" placeholder="Write a reply…"></textarea></label>
      <div class="form-error" role="alert"></div>
      <div class="row">
        <button type="submit" class="btn btn-primary">${icon('send')}Send reply</button>
        <button type="button" class="btn" id="tk-resolve">${icon('check')}Send and resolve</button>
      </div>
    </form>
  </div>`;
}

function bindThread(ctx, t) {
  const form = $('#tk-reply');
  const box = $('textarea', form);
  const err = $('.form-error', form);
  $$('[data-quick]', form).forEach((b) => b.addEventListener('click', () => {
    box.value = QUICK_REPLIES[Number(b.dataset.quick)];
    box.focus();
  }));

  const send = async (btn, status) => {
    err.textContent = '';
    if (!box.value.trim()) return (err.textContent = 'Write a reply first.');
    await withBusy(btn, async () => {
      try {
        await api(`/admin/tickets/${t.id}/messages`, { method: 'POST', body: { message: box.value, status } });
        box.value = '';
        toast(status === 'resolved' ? 'Reply sent and request resolved.' : 'Reply sent.', 'ok');
        ctx.rerender();
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send($('button[type=submit]', form));
  });
  $('#tk-resolve').addEventListener('click', (e) => send(e.currentTarget, 'resolved'));
  $('#tk-status').addEventListener('change', async (e) => {
    try {
      await api(`/admin/tickets/${t.id}`, { method: 'PUT', body: { status: e.target.value } });
      toast(`Marked as ${TICKET_LABEL[e.target.value].toLowerCase()}.`, 'ok');
      ctx.rerender();
    } catch (ex) {
      toastError(ex);
    }
  });
}
