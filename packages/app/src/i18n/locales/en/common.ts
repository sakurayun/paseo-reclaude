// English is the SOURCE catalog. Every key here defines the canonical structure that
// every other locale mirrors. `common` is the default namespace.
export default {
  action: {
    ok: "OK",
    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    remove: "Remove",
    close: "Close",
    done: "Done",
    edit: "Edit",
    add: "Add",
    copy: "Copy",
    copied: "Copied",
    copyCode: "Copy code",
    submit: "Submit",
    retry: "Retry",
    confirm: "Confirm",
    dismiss: "Dismiss",
    back: "Back",
    next: "Next",
    search: "Search",
    rename: "Rename",
  },
  state: {
    loading: "Loading…",
    error: "Error",
    errorWithMessage: "Error: {{message}}",
    empty: "Nothing here yet",
    saving: "Saving...",
    saveFailed: "Unable to save",
  },
  form: {
    nameRequired: "Name is required",
  },
  autocomplete: {
    noResults: "No results found",
  },
  combobox: {
    searchPlaceholder: "Search...",
    empty: "No options match your search.",
    useCustomPrefix: "Use",
    title: "Select",
  },
  menu: {
    backdropAccessibilityLabel: "Menu backdrop",
    open: "Open menu",
    close: "Close menu",
    toggleSidebar: "Toggle sidebar",
  },
  // Canonical product terminology (docs/glossary.md). Referenced from other keys via
  // i18next nesting — `$t(common:term.workspace)` — so every locale stays 1:1 consistent.
  term: {
    project: "Project",
    workspace: "Workspace",
    agent: "Agent",
    daemon: "Daemon",
    host: "Host",
    provider: "Provider",
    model: "Model",
    mode: "Mode",
    worktree: "Worktree",
  },
} as const;
