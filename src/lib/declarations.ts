import type { User as MarcelleUser, ObjectId } from '@marcellejs/core';

export interface User extends MarcelleUser {
  _id: ObjectId;
  username?: string;
  email?: string;
}
