import {
  maintenanceOperationSchema,
  type MaintenanceOperation,
} from "@nervekit/contracts/maintenance";
export class MaintenanceRepository {
  private latest: MaintenanceOperation | null = null;
  async read(): Promise<MaintenanceOperation | null> {
    return this.latest ? structuredClone(this.latest) : null;
  }
  async write(operation: MaintenanceOperation): Promise<void> {
    this.latest = maintenanceOperationSchema.parse(operation);
  }
}
