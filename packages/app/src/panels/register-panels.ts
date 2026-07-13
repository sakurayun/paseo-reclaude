import { agentPanelRegistration } from "@/panels/agent-panel";
import { browserPanelRegistration } from "@/panels/browser-panel";
import { draftPanelRegistration } from "@/panels/draft-panel";
import { fileDiffPanelRegistration } from "@/panels/file-diff-panel";
import { filePanelRegistration } from "@/panels/file-panel";
import { registerPanel } from "@/panels/panel-registry";
import { portForwardsPanelRegistration } from "@/panels/port-forwards-panel";
import { sessionsPanelRegistration } from "@/panels/sessions-panel";
import { setupPanelRegistration } from "@/panels/setup-panel";
import { sshConnectingPanelRegistration } from "@/panels/ssh-connecting-panel";
import { terminalPanelRegistration } from "@/panels/terminal-panel";
import { providerSubagentPanelRegistration } from "@/panels/provider-subagent-panel";

let panelsRegistered = false;

export function ensurePanelsRegistered(): void {
  if (panelsRegistered) {
    return;
  }
  registerPanel(draftPanelRegistration);
  registerPanel(agentPanelRegistration);
  registerPanel(providerSubagentPanelRegistration);
  registerPanel(setupPanelRegistration);
  registerPanel(sessionsPanelRegistration);
  registerPanel(terminalPanelRegistration);
  registerPanel(sshConnectingPanelRegistration);
  registerPanel(browserPanelRegistration);
  registerPanel(filePanelRegistration);
  registerPanel(fileDiffPanelRegistration);
  registerPanel(portForwardsPanelRegistration);
  panelsRegistered = true;
}
