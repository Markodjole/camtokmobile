export type VideoInputDevice = {
  deviceId: string;
  kind: string;
  label: string;
  facing?: string;
};

export type WideVideoConstraints = Record<string, unknown>;
