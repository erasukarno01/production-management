import type { TableMap } from "./types";

const LOCAL_API_URL = typeof window !== 'undefined' ? window.location.origin : `http://localhost:${import.meta.env.VITE_API_PORT || '5907'}`;

type QueryDef = { type: string; [key: string]: any };

type MultiResult<T> = { data: T[]; error: any; count?: number };
type SingleResult<T> = { data: T | null; error: any; count?: number };

/* ── Query builder that returns an array ── */

class MultiQueryBuilder<T extends Record<string, any>> {
  private queries: QueryDef[] = [];
  private method: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' = 'SELECT';
  private bodyData: Partial<T> | Partial<T>[] | null = null;

  constructor(private table: string) {}

  select(columns = '*', options?: { head?: boolean; count?: string }) {
    this.queries.push({ type: 'select', columns, head: options?.head, count: options?.count });
    return this;
  }

  insert(data: Partial<T> | Partial<T>[]) {
    this.method = 'INSERT'; this.bodyData = data; return this;
  }

  update(data: Partial<T>) {
    this.method = 'UPDATE'; this.bodyData = data; return this;
  }

  delete() {
    this.method = 'DELETE'; return this;
  }

  eq(column: keyof T & string, value: any) {
    this.queries.push({ type: 'eq', column, value }); return this;
  }

  in(column: keyof T & string, values: any[]) {
    this.queries.push({ type: 'in', column, values }); return this;
  }

  is(column: keyof T & string, value: any) {
    this.queries.push({ type: 'is', column, value }); return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.queries.push({ type: 'order', column, ascending: options.ascending !== false }); return this;
  }

  limit(count: number) {
    this.queries.push({ type: 'limit', count }); return this;
  }

  single(): SingleQueryBuilder<T> {
    const q = new SingleQueryBuilder<T>(this.table);
    q.inherit(this.queries, this.method, this.bodyData);
    return q;
  }

  maybeSingle(): SingleQueryBuilder<T> {
    const q = new SingleQueryBuilder<T>(this.table);
    q.inherit(this.queries, this.method, this.bodyData);
    q._maybe = true;
    return q;
  }

  then<TResult1 = MultiResult<T>, TResult2 = never>(
    onfulfilled?: ((value: MultiResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this._execute().then(onfulfilled as any, onrejected as any);
  }

  private async _execute(): Promise<MultiResult<T>> {
    try {
      const response = await fetch(`${LOCAL_API_URL}/api/local-db`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: this.table, method: this.method, queries: this.queries, data: this.bodyData })
      });
      const result = await response.json();
      return { data: (result.data ?? []) as T[], error: result.error, count: result.count };
    } catch (err: any) {
      return { data: [], error: { message: err.message }, count: 0 };
    }
  }
}

/* ── Query builder that returns a single row ── */

class SingleQueryBuilder<T extends Record<string, any>> {
  private queries: QueryDef[] = [];
  private method: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' = 'SELECT';
  private bodyData: Partial<T> | Partial<T>[] | null = null;
  _maybe = false;

  constructor(private table: string) {}

  inherit(queries: QueryDef[], method: string, data: any) {
    this.queries = queries; this.method = method as any; this.bodyData = data;
  }

  eq(column: keyof T & string, value: any) {
    this.queries.push({ type: 'eq', column, value }); return this;
  }

  then<TResult1 = SingleResult<T>, TResult2 = never>(
    onfulfilled?: ((value: SingleResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this._execute().then(onfulfilled as any, onrejected as any);
  }

  private async _execute(): Promise<SingleResult<T>> {
    try {
      const response = await fetch(`${LOCAL_API_URL}/api/local-db`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: this.table, method: this.method, queries: this.queries, data: this.bodyData })
      });
      const result = await response.json();
      const arr: T[] = result.data ?? [];
      const row = arr.length > 0 ? arr[0] : null;
      return { data: row as T | null, error: result.error, count: result.count };
    } catch (err: any) {
      return { data: null, error: { message: err.message }, count: 0 };
    }
  }
}

/* ── Auth state callbacks ── */

let authChangeCallbacks: Array<(event: any, session: any) => void> = [];

function notifyAuthChange(event: any, session: any) {
  authChangeCallbacks.forEach(cb => { try { cb(event, session); } catch (e) { console.error(e); } });
}

const mockAuth = {
  async getUser(): Promise<{ data: { user: any }; error: any }> {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('oauth_session') : null;
    if (stored) {
      try {
        const session = JSON.parse(stored);
        const resp = await fetch(`${LOCAL_API_URL}/api/local-auth/me`, {
          headers: { 'Authorization': 'Bearer ' + session.access_token }
        });
        if (resp.ok) { const { user } = await resp.json(); return { data: { user }, error: null }; }
      } catch {}
      if (typeof window !== 'undefined') localStorage.removeItem('oauth_session');
    }
    return { data: { user: null }, error: null };
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    try {
      const response = await fetch(`${LOCAL_API_URL}/api/local-auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const result = await response.json();
      if (result.error) return { data: null, error: result.error };
      const sessionData = { access_token: result.session.access_token, user: result.user };
      if (typeof window !== 'undefined') {
        localStorage.setItem('oauth_session', JSON.stringify(sessionData));
        notifyAuthChange('SIGNED_IN', { user: result.user, access_token: result.session.access_token });
      }
      return { data: { user: result.user, session: result.session }, error: null };
    } catch (err: any) { return { data: null, error: { message: err.message } }; }
  },
  async signUp({ email, password, options }: { email: string; password: string; options?: { data?: { full_name?: string } } }) {
    try {
      const response = await fetch(`${LOCAL_API_URL}/api/local-auth/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fullName: options?.data?.full_name })
      });
      const result = await response.json();
      if (result.error) return { data: null, error: result.error };
      const sessionData = { access_token: result.session.access_token, user: result.user };
      if (typeof window !== 'undefined') {
        localStorage.setItem('oauth_session', JSON.stringify(sessionData));
        notifyAuthChange('SIGNED_IN', { user: result.user, access_token: result.session.access_token });
      }
      return { data: { user: result.user, session: result.session }, error: null };
    } catch (err: any) { return { data: null, error: { message: err.message } }; }
  },
  async signOut() {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('oauth_session') : null;
    if (stored) {
      try {
        const session = JSON.parse(stored);
        await fetch(`${LOCAL_API_URL}/api/local-auth/logout`, {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + session.access_token }
        }).catch(() => {});
      } catch {}
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem('oauth_session');
      notifyAuthChange('SIGNED_OUT', null);
    }
    return { error: null };
  },
  onAuthStateChange(callback: (event: any, session: any) => void) {
    authChangeCallbacks.push(callback);
    return { data: { subscription: { unsubscribe() { authChangeCallbacks = authChangeCallbacks.filter((cb) => cb !== callback); } } } };
  }
};

/* ── Channel / Realtime Subscriptions ── */

class RealtimeChannel {
  private handlers: Array<{ event: string; filter: any; callback: (payload: any) => void }> = [];

  constructor(private name: string) {}

  on(event: string, filter: any, callback: (payload: any) => void) {
    this.handlers.push({ event, filter, callback });
    if (typeof window !== 'undefined' && (window as any).localSocket) {
      (window as any).localSocket.on('realtime_change', (payload: any) => {
        this.handlers.forEach(h => { if (payload.table === h.filter.table) h.callback(payload); });
      });
    }
    return this;
  }

  subscribe() { return this; }
}

let activeChannels: Map<string, RealtimeChannel> = new Map();

export const db = {
  auth: mockAuth,
  from<K extends keyof TableMap>(table: K): MultiQueryBuilder<TableMap[K]> {
    return new MultiQueryBuilder<TableMap[K]>(table);
  },
  channel(name: string): RealtimeChannel {
    const ch = new RealtimeChannel(name);
    activeChannels.set(name, ch);
    return ch;
  },
  removeChannel(ch: RealtimeChannel) {
    for (const [key, val] of activeChannels) { if (val === ch) { activeChannels.delete(key); break; } }
  },
  removeAllChannels() { activeChannels.clear(); }
};
