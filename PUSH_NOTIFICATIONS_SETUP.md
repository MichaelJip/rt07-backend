# Push Notifications Setup Guide

## Backend Setup Complete ✅

Your backend is now ready to send push notifications to your Expo Go mobile app!

## What Was Implemented

### 1. User Model Update
- Added `expoPushToken` field to store Expo push tokens ([user.model.ts:47-50](src/models/user.model.ts#L47-L50))

### 2. Notification Service
- Created reusable notification service ([notification.service.ts](src/utils/notification.service.ts))
- Supports sending to:
  - Single user by ID
  - Multiple users by IDs
  - Single token
  - Multiple tokens (batched)
  - All users with a specific role

### 3. API Endpoint
- **POST** `/api/auth/push-token` - Save/update user's push token
  - Requires authentication
  - Body: `{ "pushToken": "ExponentPushToken[...]" }`

### 4. Auto Notifications
Notifications are automatically sent when:
- ✅ Payment is confirmed (PAID) - [iuran.controller.ts:263-273](src/controller/iuran.controller.ts#L263-L273)
- ❌ Payment is rejected (REJECTED) - [iuran.controller.ts:274-288](src/controller/iuran.controller.ts#L274-L288)
- 📋 New monthly iuran is generated (manual endpoint) - [iuran.controller.ts:467-476](src/controller/iuran.controller.ts#L467-L476)
- 📋 New monthly iuran is generated (cron job) - [generateIuran.ts:55-65](src/config/generateIuran.ts#L55-L65)

## Frontend Integration (Expo)

### 1. Install Required Packages
```bash
npx expo install expo-notifications expo-device
```

### 2. Update Your App.tsx/App.js

```typescript
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { useEffect, useRef } from 'react';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function App() {
  const notificationListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    registerForPushNotificationsAsync();

    // Listen for notifications when app is in foreground
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    // Listen for user tapping on notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('User tapped notification:', response);

      // Navigate based on notification data
      const data = response.notification.request.content.data;
      if (data.type === 'iuran_status_update') {
        // Navigate to iuran detail screen
        navigation.navigate('IuranDetail', { id: data.iuranId });
      } else if (data.type === 'new_iuran') {
        // Navigate to iuran list screen
        navigation.navigate('IuranList');
      }
    });

    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  return (
    // Your app content
  );
}

async function registerForPushNotificationsAsync() {
  let token;

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      alert('Failed to get push token for push notification!');
      return;
    }

    token = (await Notifications.getExpoPushTokenAsync()).data;
    console.log('Push token:', token);

    // Send this token to your backend
    await sendTokenToBackend(token);
  } else {
    console.log('Must use physical device for Push Notifications');
  }

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  return token;
}

async function sendTokenToBackend(token) {
  try {
    const response = await fetch('YOUR_BACKEND_URL/api/auth/push-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${YOUR_AUTH_TOKEN}` // Get from your auth state
      },
      body: JSON.stringify({
        pushToken: token
      })
    });

    if (response.ok) {
      console.log('Push token registered successfully');
    } else {
      console.error('Failed to register push token');
    }
  } catch (error) {
    console.error('Error registering push token:', error);
  }
}
```

### 3. Register Token After Login

Call `registerForPushNotificationsAsync()` after successful login:

```typescript
// In your login function
async function handleLogin(username, password) {
  const response = await loginAPI(username, password);
  if (response.success) {
    // Save token to state/storage
    await AsyncStorage.setItem('authToken', response.data);

    // Register for push notifications
    await registerForPushNotificationsAsync();

    // Navigate to home
    navigation.replace('Home');
  }
}
```

## Notification Data Structure

Each notification includes data that you can use for navigation:

### Payment Confirmed
```json
{
  "type": "iuran_status_update",
  "iuranId": "507f1f77bcf86cd799439011",
  "status": "paid",
  "period": "2025-12"
}
```

### Payment Rejected
```json
{
  "type": "iuran_status_update",
  "iuranId": "507f1f77bcf86cd799439011",
  "status": "rejected",
  "period": "2025-12",
  "note": "Invalid proof image"
}
```

### New Monthly Iuran
```json
{
  "type": "new_iuran",
  "period": "2025-12"
}
```

## Testing Push Notifications

### 1. Test on Physical Device
- Push notifications **only work on physical devices**, not simulators/emulators
- Install Expo Go app on your phone
- Run your app with `npx expo start`

### 2. Test Notification Sending

You can manually test sending notifications using the notification service:

```typescript
// In any controller or route
import notificationService from "../utils/notification.service";

// Send to specific user
await notificationService.sendToUser(userId, {
  title: "Test Notification",
  body: "This is a test message",
  data: { test: true }
});

// Send to all WARGA users
await notificationService.sendToRole("warga", {
  title: "Announcement",
  body: "This is an announcement for all residents",
  data: { type: "announcement" }
});
```

### 3. Check Notification Logs

The notification service logs all activity:
- Successful sends
- Invalid tokens
- Error messages

Check your server console for logs.

## Troubleshooting

### Token Not Registering
- Ensure user is authenticated when calling `/api/auth/push-token`
- Check that the token format is valid (starts with `ExponentPushToken[`)
- Verify the Authorization header is correct

### Notifications Not Received
- Ensure you're testing on a **physical device** (not simulator)
- Check that notification permissions are granted
- Verify the push token is saved in the database
- Check server logs for any errors

### DeviceNotRegistered Error
- This means the token is no longer valid (user uninstalled app or cleared data)
- The service logs this error automatically
- Consider removing invalid tokens from the database

## Next Steps

1. **Test the endpoint**: Try registering a push token after login
2. **Test notifications**: Create and update iuran payments to trigger notifications
3. **Add navigation**: Handle notification taps to navigate to relevant screens
4. **Customize**: Adjust notification titles/bodies to match your app's tone

## Additional Features You Can Add

- 📱 Notification history screen
- 🔕 User notification preferences (enable/disable specific types)
- 📊 Notification analytics (track open rates)
- 🔔 Custom sounds for different notification types
- 📅 Scheduled/reminder notifications

## Resources

- [Expo Push Notifications Guide](https://docs.expo.dev/push-notifications/overview/)
- [Expo Server SDK](https://github.com/expo/expo-server-sdk-node)
- [Testing Push Notifications](https://docs.expo.dev/push-notifications/testing/)
