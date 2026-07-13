import { useEffect, useMemo, useState } from "react";
import {
  getBuiltInOsIcon,
  OS_ICON_FALLBACK,
  type OsIconDescriptor,
  toSimpleIconsSlug,
} from "@/components/ssh/os-icons";
import { loadRemoteOsIcon, peekRemoteOsIcon } from "@/components/ssh/remote-os-icons";

export interface UseOsIconResult extends OsIconDescriptor {
  // True only while a remote fetch is in flight (built-ins are never loading).
  loading: boolean;
}

// Resolves an OS badge glyph: offline catalog first, then Simple Icons CDN
// with memory + AsyncStorage cache. Obscure /etc/os-release IDs still get a
// correct brand mark when Simple Icons knows the slug.
export function useOsIcon(os: string | null | undefined): UseOsIconResult {
  const builtin = useMemo(() => getBuiltInOsIcon(os), [os]);
  const slug = useMemo(() => (os && !builtin ? toSimpleIconsSlug(os) : null), [os, builtin]);

  const initialRemote = useMemo(() => {
    if (!slug) {
      return undefined as ReturnType<typeof peekRemoteOsIcon>;
    }
    return peekRemoteOsIcon(slug);
  }, [slug]);

  const [remote, setRemote] = useState<OsIconDescriptor | null | undefined>(() => {
    if (initialRemote === undefined) {
      return undefined;
    }
    if (initialRemote === null) {
      return null;
    }
    return { ...initialRemote, source: "remote" };
  });
  const [loading, setLoading] = useState(() => Boolean(slug) && initialRemote === undefined);

  useEffect(() => {
    if (builtin || !slug) {
      setRemote(undefined);
      setLoading(false);
      return;
    }

    const peeked = peekRemoteOsIcon(slug);
    if (peeked !== undefined) {
      setRemote(peeked ? { ...peeked, source: "remote" } : null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setRemote(undefined);

    void loadRemoteOsIcon(slug).then((glyph) => {
      if (cancelled) {
        return undefined;
      }
      setRemote(glyph ? { ...glyph, source: "remote" } : null);
      setLoading(false);
      return undefined;
    });

    return () => {
      cancelled = true;
    };
  }, [builtin, slug]);

  if (builtin) {
    return { ...builtin, loading: false };
  }

  if (remote) {
    return { ...remote, loading: false };
  }

  return { ...OS_ICON_FALLBACK, loading };
}
