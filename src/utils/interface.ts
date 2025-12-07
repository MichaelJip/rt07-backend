import { Request } from "express";
import { User } from "../models/user.model";
import { Types } from "mongoose";

export interface IUserToken
  extends Omit<User, "password" | "email" | "username"> {
  id?: Types.ObjectId;
}

export interface IReqUser extends Request {
  user?: IUserToken;
}

export interface IPaginationQuery {
  page: number;
  limit: number;
  search?: string;
}
