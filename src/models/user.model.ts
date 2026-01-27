import mongoose from "mongoose";
import { z } from "zod";
import { ROLES, USER_STATUS } from "../utils/constants";
import { encrypt } from "../utils/encryption";
import { UserDTO } from "../utils/zodSchema";

export const USER_MODEL_NAME = "User";

export type TUser = z.infer<typeof UserDTO>;

export interface User extends Omit<TUser, ""> {}

const Schema = mongoose.Schema;

const userSchema = new Schema(
  {
    email: {
      type: Schema.Types.String,
      required: true,
      unique: true,
    },
    username: {
      type: Schema.Types.String,
      required: true,
      unique: true,
    },
    password: {
      type: Schema.Types.String,
      required: true,
    },
    role: {
      type: Schema.Types.String,
      enum: [
        ROLES.ADMIN,
        ROLES.RT,
        ROLES.RW,
        ROLES.BENDAHARA,
        ROLES.SATPAM,
        ROLES.WARGA,
      ],
      default: ROLES.WARGA,
    },
    address: {
      type: Schema.Types.String,
    },
    position: {
      type: Schema.Types.String,
    },
    phone_number: {
      type: Schema.Types.String,
      minLength: 10,
      maxLength: 15,
    },
    image_url: {
      type: Schema.Types.String,
    },
    expoPushToken: {
      type: Schema.Types.String,
      default: null,
    },
    status: {
      type: Schema.Types.String,
      enum: [USER_STATUS.ACTIVE, USER_STATUS.INACTIVE, USER_STATUS.AWAY],
      default: USER_STATUS.ACTIVE,
    },
    statusNote: {
      type: Schema.Types.String,
      default: null,
    },
    isDeleted: {
      type: Schema.Types.Boolean,
      default: false,
    },
    deletedAt: {
      type: Schema.Types.Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre("save", function () {
  this.password = encrypt(this.password);
});

userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  return user;
};

const userModel = mongoose.model(USER_MODEL_NAME, userSchema);

export default userModel;
