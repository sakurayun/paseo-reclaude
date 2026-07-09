import { useEffect, useState } from "react";
import { openSshHostForm, type SshHostFormSnapshot } from "./ssh-host-form-model";

export function useSshHostFormModel(snapshot: SshHostFormSnapshot) {
  const [model] = useState(() => openSshHostForm(snapshot));

  useEffect(() => {
    return () => {
      model.close();
    };
  }, [model]);

  // Late-arriving option lists (groups/keys/other hosts) are fed in without
  // reconstructing the model — see docs/forms.md.
  useEffect(() => {
    model.applyOptions({
      groups: snapshot.groups,
      keys: snapshot.keys,
      chainCandidates: snapshot.chainCandidates,
    });
  }, [model, snapshot.groups, snapshot.keys, snapshot.chainCandidates]);

  return model;
}
