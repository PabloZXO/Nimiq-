import { currency, paymentMessages, type PaymentNetwork } from './payment-network';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from './api';
import { messages, errorText } from './i18n';
import type { Invitation, Language, User } from './types';

type Friend = { nickname: string; status: 'online' | 'playing' | 'offline' };
const presenceOrder = { online: 0, playing: 1, offline: 2 };

export function People({ network, lang, user, invitations, busy, invite, act, open, wallet }: {
  network?: PaymentNetwork; lang: Language; user: User | null; invitations: Invitation[]; busy: boolean;
  invite: (nickname: string) => void; act: (id: string, action: string) => void;
  open: (code: string) => void; wallet: () => void;
}) {
  const t = paymentMessages(lang, network), [query, setQuery] = useState(''), [player, setPlayer] = useState<string | null>(null);
  const [searched, setSearched] = useState(false), [searching, setSearching] = useState(false), [error, setError] = useState<unknown>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendQuery, setFriendQuery] = useState('');
  const friendFilter = friendQuery.trim().replace(/^@/, '').toLowerCase();
  const visibleFriends = friends.filter(friend => friend.nickname.toLowerCase().includes(friendFilter))
    .sort((a, b) => (presenceOrder[a.status] ?? 3) - (presenceOrder[b.status] ?? 3) || a.nickname.localeCompare(b.nickname, 'en'));
  const [friendsLoading, setFriendsLoading] = useState(true), [friendsError, setFriendsError] = useState<unknown>(null);
  const [friendActionError, setFriendActionError] = useState<unknown>(null);
  const friendSequence = useRef(0);
  const [refresh, setRefresh] = useState(0), [saving, setSaving] = useState(false), savingRef = useRef(false);
  useEffect(() => {
    if (!user?.nickname) { setFriends([]); setFriendsLoading(false); return; }
    const controller = new AbortController();
    setFriendsLoading(true); setFriendsError(null);
    let pending = false;
    async function poll() {
      if (document.visibilityState !== 'visible' || pending || savingRef.current) return;
      pending = true;
      const sequence = ++friendSequence.current;
      try {
        const result = await api<{ friends: Friend[] }>('/friends', undefined, controller.signal);
        if (!controller.signal.aborted && sequence === friendSequence.current) { setFriends(result.friends); setFriendsError(null); }
      } catch (e) { if (!controller.signal.aborted && sequence === friendSequence.current) setFriendsError(e); }
      finally { pending = false; if (!controller.signal.aborted) setFriendsLoading(false); }
    }
    void poll();
    const timer = setInterval(poll, 5000);
    document.addEventListener('visibilitychange', poll);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, [user?.id, user?.nickname, refresh]);
  async function changeFriend(nickname: string, action: 'add' | 'remove') {
    if (savingRef.current) return;
    savingRef.current = true; ++friendSequence.current; setSaving(true); setFriendActionError(null);
    try {
      const result = await api<{ friends: Friend[] }>('/friends', { nickname, action });
      setFriends(result.friends); setFriendsError(null);
    } catch (e) { setFriendActionError(e); }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function lookup(event: FormEvent) {
    event.preventDefault(); if (searching) return;
    setSearching(true); setError(null); setSearched(false); setPlayer(null);
    try {
      const result = await api<{ player: { nickname: string } | null }>(`/players?nickname=${encodeURIComponent(query)}`);
      setPlayer(result.player?.nickname ?? null); setSearched(true);
    } catch (e) { setError(e); } finally { setSearching(false); }
  }
  return <div className="people-page"><section className="panel"><h1>{t.people}</h1>
    {!user?.nickname ? <><p className="muted">{t.peopleNeedNickname}</p><button className="button primary" onClick={wallet}>{t.wallet}</button></> : <>
      <p className="nickname-value">@{user.nickname} <span className="identity-badge" aria-label={t.registeredNickname}>✓</span></p>
      <p className="muted">{t.peopleIntro}</p><form onSubmit={lookup} className="people-search"><label className="field">{t.findNickname}<input value={query} onChange={e => setQuery(e.target.value)} placeholder="@nickname" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={24} disabled={searching} /></label><button className="button secondary" disabled={searching || !query.trim()}>{searching ? t.loading : t.findPlayer}</button></form>
      {Boolean(error) && <p className="error-text" role="alert">{errorText(error, lang)}</p>}
      {searched && (player ? <div className="person-result"><strong>@{player} <span className="identity-badge" aria-label={t.registeredNickname}>✓</span></strong>{player === user.nickname ? <span>{t.you}</span> : <div className="friend-actions"><button className="button secondary" disabled={saving || friendsLoading || Boolean(friendsError) || friends.some(f => f.nickname === player)} onClick={() => void changeFriend(player, 'add')}>{friends.some(f => f.nickname === player) ? t.friendSaved : t.addFriend}</button><button className="button primary" disabled={busy} onClick={() => invite(player)}>{t.inviteDuel}</button></div>}</div> : <p role="status">{t.playerNotFound}</p>)}
    </>}
    </section>{user?.nickname && <section className="panel" aria-labelledby="friends-heading"><h2 id="friends-heading">{t.friendsTitle} <span className="muted small">{friendsLoading || friendsError ? '' : friendFilter ? `(${visibleFriends.length} / ${friends.length})` : `(${friends.length})`}</span></h2>
      <p className="muted small">{t.friendsIntro}</p>
      {(friends.length > 0 || friendQuery) && <div className="friend-filter"><label className="field">{t.filterFriends}<input type="search" value={friendQuery} onChange={e => setFriendQuery(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={24} /></label>{friendQuery && <button className="text-button" onClick={() => setFriendQuery('')}>{t.clearFriendSearch}</button>}<p className="muted small">{t.friendSortOrder}</p></div>}
      {Boolean(friendActionError) && <p className="error-text" role="alert">{errorText(friendActionError, lang)}</p>}
      {friendsLoading ? <p role="status">{t.loading}</p> : friendsError ? <><p className="error-text" role="alert">{errorText(friendsError, lang)}</p><button className="button secondary" onClick={() => setRefresh(n => n + 1)}>{t.friendsRetry}</button></> : visibleFriends.length ? <ul className="friend-list">{visibleFriends.map(friend => <li className="friend-row" key={friend.nickname}>
        <div className="friend-identity"><strong>@{friend.nickname}</strong><span className={`friend-presence ${friend.status ?? 'unknown'}`}><i aria-hidden="true" />{t[friend.status === 'online' ? 'presenceOnline' : friend.status === 'playing' ? 'presencePlaying' : friend.status === 'offline' ? 'presenceOffline' : 'presenceUnknown']}</span></div><div className="friend-actions"><button className="button primary" disabled={busy} onClick={() => invite(friend.nickname)}>{t.inviteDuel}</button><button className="text-button" disabled={saving} aria-label={`${t.removeFriend} @${friend.nickname}`} onClick={() => void changeFriend(friend.nickname, 'remove')}>{t.removeFriend}</button></div>
      </li>)}</ul> : <p role="status" className="muted">{friends.length ? t.noFriendsFound : t.noFriends}</p>}
    </section>}<section className="panel"><h2>{t.invitations}</h2>{invitations.length ? <div className="invitation-list">{invitations.map(item => <article className="invitation-item" key={item.id}>
      <h3>{item.incoming ? t.invitationFrom : t.invitationTo} <strong>@{item.incoming ? item.from : item.to}</strong></h3>
      <p>{t[item.topic]}{item.topic !== 'chess' && ` · ${t[item.difficulty as 'easy' | 'normal' | 'hard']}`} · {item.stakeLuna ? `${t.entryPerPlayer}: ${(item.stakeLuna / 100000).toLocaleString(lang)} ${currency(item.paymentNetwork)}` : t.freeEntry}</p>
      <p className="muted small">{t[`invitation_${item.status}` as keyof typeof t]}{item.status === 'pending' && ` · ${t.invitationUntil} ${new Date(item.expiresAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}`}</p>
      <div className="invitation-actions">{item.status === 'pending' && (item.incoming ? <><button className="button primary" disabled={busy} onClick={() => act(item.id, 'accept')}>{t.acceptInvitation}</button><button className="text-button" disabled={busy} onClick={() => act(item.id, 'decline')}>{t.declineInvitation}</button></> : <button className="text-button" disabled={busy} onClick={() => act(item.id, 'cancel')}>{t.cancelInvitation}</button>)}
        {item.roomCode && ['pending', 'accepted'].includes(item.status) && <button className="button secondary" disabled={busy} onClick={() => open(item.roomCode!)}>{t.openDuel}</button>}
      </div>
    </article>)}</div> : <p className="muted">{t.noInvitations}</p>}</section>
  </div>;
}
