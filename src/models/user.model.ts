import mongoose from "mongoose";
import { z } from "zod";
import { ROLES, USER_STATUS } from "../utils/constants";
import { encrypt } from "../utils/encryption";
import { UserDTO } from "../utils/zodSchema";

export const USER_MODEL_NAME = "User";

export type TUser = z.infer<typeof UserDTO>;

export interface User extends Omit<TUser, ""> {}

const Schema = mongoose.Schema;

export interface FamilyMember {
  _id?: mongoose.Types.ObjectId;
  name: string;
  birth_date: Date;
  relation: string;
}

const familyMemberSchema = new Schema<FamilyMember>({
  name: {
    type: Schema.Types.String,
    required: true,
  },
  birth_date: {
    type: Schema.Types.Date,
    required: true,
  },
  relation: {
    // Free text, validated at the controller against the admin-configurable
    // "family_relations" settings list (see settings.controller.ts) rather than
    // a hardcoded enum here — RT wants to add relation types without a code change.
    type: Schema.Types.String,
    required: true,
  },
});

const userSchema = new Schema(
  {
    // Head of family's own date of birth (optional — backfilled data won't have it).
    // Family members below are everyone else in the household.
    birth_date: {
      type: Schema.Types.Date,
      default: null,
    },
    family_members: {
      type: [familyMemberSchema],
      default: [],
    },
    email: {
      type: Schema.Types.String,
      required: false,
      sparse: true, // allows null/undefined to not conflict with unique index
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
        ROLES.SEKRETARIS,
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
      enum: [USER_STATUS.ACTIVE, USER_STATUS.INACTIVE, USER_STATUS.AWAY, USER_STATUS.MOVED],
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
