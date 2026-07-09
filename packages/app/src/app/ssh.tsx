import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { SshScreen } from "@/screens/ssh/ssh-screen";

export default function SshRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <SshScreen />
    </HostRouteBootstrapBoundary>
  );
}
