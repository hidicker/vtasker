
export interface Waypoint {
  id: string;
  shortName: string;
  name: string;
  lat: number;
  lng: number;
  altM: number;
}

export enum TaskPointType {
  TAKEOFF = 'takeoff',
  SSS = 'sss',
  TURNPOINT = 'turnpoint',
  ESS = 'ess',
  GOAL = 'goal'
}

export enum TurnDirection {
  ENTRY = 'entry',
  EXIT = 'exit'
}

export interface TaskPoint {
  id: string;
  waypoint: Waypoint;
  type: TaskPointType;
  radius: number; // in meters
  direction: TurnDirection;
}

export interface Task {
  name: string;
  points: TaskPoint[];
}
