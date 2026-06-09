export default {
  diff: {
    badgeNew: "New",
    badgeDeleted: "Deleted",
    binaryFile: "Binary file",
    tooLarge: "Diff too large to display",
    layoutUnified: "Unified diff",
    layoutSplit: "Side-by-side diff",
    hideWhitespace: "Hide whitespace",
    wrapLongLines: "Wrap long lines",
    scrollLongLines: "Scroll long lines",
    expandAllFiles: "Expand all files",
    collapseAllFiles: "Collapse all files",
  },
  pane: {
    checkingRepository: "Checking repository...",
    notGitRepository: "Not a git repository",
    diffModeLabel: "Diff mode",
    modeUncommitted: "Uncommitted",
    modeCommitted: "Committed",
  },
  empty: {
    noVisibleChanges: "No visible changes after hiding whitespace",
    noUncommittedChanges: "No uncommitted changes",
    noChangesVsBase: "No changes vs {{baseRefLabel}}",
  },
  errors: {
    refreshFailed: "Failed to refresh git state.",
  },
  actions: {
    refresh: "Refresh",
    refreshing: "Refreshing",
    refreshState: "Refresh git and GitHub state",
    branchLabel: {
      notGitRepository: "Not a git repository",
      unknown: "Unknown",
    },
    baseRef: {
      fallbackLabel: "base",
    },
    splitButton: {
      moreOptions: "More options",
      moreActions: "More actions",
    },
    store: {
      error: {
        daemonClientUnavailable: "Daemon client unavailable",
        autoMergeUpdateHost: "Update the host to use GitHub auto-merge actions.",
      },
    },
    toast: {
      baseRefUnavailable: "Base ref unavailable",
      worktreePathUnavailable: "Worktree path unavailable",
      commit: { success: "Committed", error: "Failed to commit" },
      pull: { success: "Pulled", error: "Failed to pull" },
      push: { success: "Pushed", error: "Failed to push" },
      pullAndPush: { success: "Pulled and pushed", error: "Failed to pull and push" },
      createPr: { success: "PR created", error: "Failed to create PR" },
      mergePr: { success: "PR merged", error: "Failed to merge PR" },
      enableAutoMerge: { success: "Auto-merge enabled", error: "Failed to enable auto-merge" },
      disableAutoMerge: { success: "Auto-merge disabled", error: "Failed to disable auto-merge" },
      mergeBranch: { success: "Merged", error: "Failed to merge" },
      mergeFromBase: { success: "Updated", error: "Failed to merge from base" },
      archiveWorktree: { error: "Failed to archive worktree" },
    },
  },
  policy: {
    action: {
      commit: "Commit",
      pull: "Pull",
      push: "Push",
      pullAndPush: "Pull and push",
      viewPr: "View PR",
      createPr: "Create PR",
      mergePrSquash: "Squash and merge",
      mergePrMerge: "Create a merge commit",
      mergePrRebase: "Rebase and merge",
      enableAutoMergeSquash: "Enable auto-merge with squash",
      enableAutoMergeMerge: "Enable auto-merge with merge commit",
      enableAutoMergeRebase: "Enable auto-merge with rebase",
      autoMergeEnabled: "Auto-merge enabled",
      mergeBranch: "Merge locally",
      updateFromBase: "Update from {{baseRef}}",
      archiveWorktree: "Archive worktree",
    },
    pending: {
      committing: "Committing...",
      pulling: "Pulling...",
      pushing: "Pushing...",
      pullingAndPushing: "Pulling and pushing...",
      creatingPr: "Creating PR...",
      mergingPr: "Merging PR...",
      enablingAutoMerge: "Enabling auto-merge...",
      disablingAutoMerge: "Disabling auto-merge...",
      merging: "Merging...",
      updating: "Updating...",
      archiving: "Archiving...",
    },
    success: {
      committed: "Committed",
      pulled: "Pulled",
      pushed: "Pushed",
      pulledAndPushed: "Pulled and pushed",
      prCreated: "PR Created",
      prMerged: "PR merged",
      autoMergeEnabled: "Auto-merge enabled",
      autoMergeDisabled: "Auto-merge disabled",
      merged: "Merged",
      updated: "Updated",
      archived: "Archived",
    },
    unavailable: {
      pullNoRemote:
        "Pull isn't available here because this branch is not connected to a remote yet",
      pullLocalChanges:
        "Pull isn't available while you have local changes so commit or stash them first",
      pullUpToDate: "Pull isn't available because this branch is already up to date",
      pushNoRemote:
        "Push isn't available here because this branch is not connected to a remote yet",
      pushBehind: "Push isn't available yet because there are newer changes to bring in first",
      pushNothingNew: "Push isn't available because there is nothing new to send",
      pullAndPushNoRemote:
        "Pull and push isn't available here because this branch is not connected to a remote yet",
      pullAndPushLocalChanges:
        "Pull and push isn't available while you have local changes so commit or stash them first",
      pullAndPushInSync: "Pull and push isn't available because this branch is already in sync",
      pullAndPushNoIncoming:
        "Pull and push isn't available because there are no incoming changes to pull first",
      pullAndPushNothingNew:
        "Pull and push isn't available because there is nothing new to send after pulling",
      createPrGithubNotConnected:
        "Create PR isn't available right now because GitHub isn't connected",
      createPrNoCommits:
        "Create PR isn't available because this branch doesn't have any new commits yet",
      viewPrGithubNotConnected: "View PR isn't available right now because GitHub isn't connected",
      mergeNoBaseBranch: "Merge isn't available because we couldn't determine the base branch",
      mergeLocalChanges:
        "Merge isn't available while you have local changes so commit or stash them first",
      mergeNothingNew:
        "Merge isn't available because this branch doesn't have anything new to merge yet",
      updateNoBaseBranch: "Update isn't available because we couldn't determine the base branch",
      updateLocalChanges:
        "Update isn't available while you have local changes so commit or stash them first",
      updateUpToDate:
        "Update isn't available because this branch is already up to date with {{baseRef}}",
      mergePrGithubNotConnected:
        "Merge PR isn't available right now because GitHub isn't connected",
      mergePrNoPullRequest: "Merge PR isn't available because there isn't a pull request yet",
      mergePrDraft: "Merge PR isn't available because the pull request is still a draft",
      mergePrAlreadyMerged: "Merge PR isn't available because the pull request is already merged",
      mergePrClosed: "Merge PR isn't available because the pull request is closed",
      mergePrConflicts: "Merge PR isn't available because the pull request has conflicts",
      mergePrMergeQueue: "Merge PR isn't available here because this repository uses a merge queue",
      mergePrNotReady:
        "Merge PR isn't available until GitHub reports the pull request is ready to merge",
      autoMergeCannotDisable: "Auto-merge is enabled, but this account can't disable it",
      archiveNotPaseoWorktree:
        "Archive isn't available here because this workspace was not created as a Paseo worktree",
    },
  },
  pr: {
    state: {
      open: "Open",
      draft: "Draft",
      merged: "Merged",
      closed: "Closed",
    },
    activity: {
      commented: "Commented",
      approved: "Approved",
      requestedChanges: "Requested changes",
      reviewed: "Reviewed",
    },
  },
  prPane: {
    section: {
      checks: "Checks",
      reviews: "Reviews",
    },
  },
  archive: {
    diffStat: {
      added_one: "{{count}} added line",
      added_other: "{{count}} added lines",
      deleted_one: "{{count}} deleted line",
      deleted_other: "{{count}} deleted lines",
      separator: ", ",
    },
    reason: {
      uncommittedChanges: "Uncommitted changes",
      uncommittedChangesWithStat: "Uncommitted changes ({{stat}})",
      unpushedCommits_one: "{{count}} unpushed commit",
      unpushedCommits_other: "{{count}} unpushed commits",
    },
    confirm: {
      title: 'Archive "{{worktreeName}}"?',
      confirmLabel: "Archive",
      cancelLabel: "Cancel",
    },
  },
} as const;
