import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import userModel from "../models/user.model";
import { Types } from "mongoose";

const expo = new Expo();

export interface NotificationPayload {
  title: string;
  body: string;
  data?: { [key: string]: any };
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high";
}

class NotificationService {
  async sendToUser(
    userId: string | Types.ObjectId,
    notification: NotificationPayload
  ): Promise<void> {
    try {
      const user = await userModel.findById(userId).select("expoPushToken");

      if (!user || !user.expoPushToken) {
        console.log(`User ${userId} has no push token registered`);
        return;
      }

      await this.sendToToken(user.expoPushToken, notification);
    } catch (error) {
      console.error(`Failed to send notification to user ${userId}:`, error);
    }
  }

  async sendToUsers(
    userIds: (string | Types.ObjectId)[],
    notification: NotificationPayload
  ): Promise<void> {
    try {
      const users = await userModel
        .find({ _id: { $in: userIds } })
        .select("expoPushToken");

      const tokens = users
        .filter((user) => user.expoPushToken)
        .map((user) => user.expoPushToken as string);

      if (tokens.length === 0) {
        console.log("No users with valid push tokens found");
        return;
      }

      await this.sendToTokens(tokens, notification);
    } catch (error) {
      console.error("Failed to send notifications to users:", error);
    }
  }

  async sendToToken(
    token: string,
    notification: NotificationPayload
  ): Promise<void> {
    if (!Expo.isExpoPushToken(token)) {
      console.error(`Push token ${token} is not a valid Expo push token`);
      return;
    }

    const message: ExpoPushMessage = {
      to: token,
      sound: notification.sound ?? "default",
      title: notification.title,
      body: notification.body,
      data: notification.data ?? {},
      badge: notification.badge,
      channelId: notification.channelId ?? "default",
      priority: notification.priority ?? "high",
    };

    try {
      const ticketChunk = await expo.sendPushNotificationsAsync([message]);
      this.handleTickets(ticketChunk);
    } catch (error) {
      console.error("Error sending notification:", error);
    }
  }

  async sendToTokens(
    tokens: string[],
    notification: NotificationPayload
  ): Promise<void> {
    const validTokens = tokens.filter((token) => Expo.isExpoPushToken(token));

    if (validTokens.length === 0) {
      console.log("No valid Expo push tokens to send to");
      return;
    }

    // Create messages
    const messages: ExpoPushMessage[] = validTokens.map((token) => ({
      to: token,
      sound: notification.sound ?? "default",
      title: notification.title,
      body: notification.body,
      data: notification.data ?? {},
      badge: notification.badge,
      channelId: notification.channelId ?? "default",
      priority: notification.priority ?? "high",
    }));

    const chunks = expo.chunkPushNotifications(messages);

    try {
      for (const chunk of chunks) {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        this.handleTickets(ticketChunk);
      }
    } catch (error) {
      console.error("Error sending notifications:", error);
    }
  }

  async sendToRole(
    role: string,
    notification: NotificationPayload
  ): Promise<void> {
    try {
      const users = await userModel
        .find({ role, expoPushToken: { $ne: null } })
        .select("expoPushToken");

      const tokens = users.map((user) => user.expoPushToken as string);

      if (tokens.length === 0) {
        console.log(`No users with role ${role} have push tokens`);
        return;
      }

      await this.sendToTokens(tokens, notification);
    } catch (error) {
      console.error(`Failed to send notifications to role ${role}:`, error);
    }
  }

  private handleTickets(tickets: ExpoPushTicket[]): void {
    tickets.forEach((ticket) => {
      if (ticket.status === "error") {
        console.error(`Error sending notification: ${ticket.message}`);
        if (ticket.details?.error) {
          console.error(`Error details:`, ticket.details.error);

          if (ticket.details.error === "DeviceNotRegistered") {
            console.log(
              "Device token is no longer valid, should remove from database"
            );
          }
        }
      }
    });
  }
}

export default new NotificationService();
