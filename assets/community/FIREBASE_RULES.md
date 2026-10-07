rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function myProfileDoc() {
      return get(/databases/$(database)/documents/profiles/$(request.auth.uid));
    }

    function myRole() {
      return signedIn() && myProfileDoc().data.role is string
        ? myProfileDoc().data.role
        : 'member';
    }

    function staff() {
      return myRole() in ['owner', 'co_owner', 'admin', 'mod'];
    }

    function owner() {
      return myRole() == 'owner';
    }

    function coOwner() {
      return myRole() == 'co_owner';
    }

    function seniorStaff() {
      return owner() || coOwner();
    }

    match /profiles/{uid} {
      allow read: if signedIn();

      allow create: if signedIn()
        && request.auth.uid == uid
        && request.resource.data.role == 'member'
        && request.resource.data.username is string;

      allow update: if signedIn() && (
        owner()
        || (
          coOwner()
          && resource.data.role != 'owner'
          && request.resource.data.role != 'owner'
        )
        || (
          request.auth.uid == uid
          && request.resource.data.role == resource.data.role
        )
      );

      allow delete: if seniorStaff() && request.auth.uid != uid;
      allow delete: if request.auth.uid == uid;
    }

    match /deletedAccounts/{uid} {
      allow read: if signedIn() && (request.auth.uid == uid || seniorStaff());
      allow create: if signedIn()
        && (request.auth.uid == uid || seniorStaff())
        && request.resource.data.username is string;
      allow update, delete: if signedIn()
        && (request.auth.uid == uid || seniorStaff());
    }

    match /messages/{id} {
      allow read: if signedIn();

      allow create: if signedIn()
        && request.resource.data.user_id == request.auth.uid
        && request.resource.data.body is string;

      allow update: if signedIn() && (
        seniorStaff()
        || myRole() == 'admin'
        || resource.data.user_id == request.auth.uid
      );

      allow delete: if signedIn() && (
        seniorStaff()
        || myRole() == 'admin'
        || resource.data.user_id == request.auth.uid
      );

      match /attachments/{attachmentId} {
        allow read: if signedIn();

        allow create: if signedIn()
          && get(/databases/$(database)/documents/messages/$(id)).data.user_id == request.auth.uid;

        allow update, delete: if signedIn() && (
          seniorStaff()
          || myRole() == 'admin'
          || get(/databases/$(database)/documents/messages/$(id)).data.user_id == request.auth.uid
        );
      }
    }

    match /posts/{id} {
      allow read: if signedIn();

      allow create: if signedIn()
        && request.resource.data.user_id == request.auth.uid
        && request.resource.data.title is string
        && request.resource.data.body is string;

      allow update, delete: if signedIn() && (
        staff()
        || resource.data.user_id == request.auth.uid
      );

      match /attachments/{attachmentId} {
        allow read: if signedIn();

        allow create: if signedIn() && (
          staff()
          || get(/databases/$(database)/documents/posts/$(id)).data.user_id == request.auth.uid
        );

        allow update, delete: if signedIn() && (
          staff()
          || get(/databases/$(database)/documents/posts/$(id)).data.user_id == request.auth.uid
        );
      }
    }

    match /appeals/{id} {
      allow create: if signedIn()
        && request.resource.data.user_id == request.auth.uid
        && request.resource.data.username is string
        && request.resource.data.status == 'pending';

      allow read: if signedIn() && (
        resource.data.user_id == request.auth.uid
        || staff()
      );

      allow update: if signedIn()
        && myRole() in ['owner', 'co_owner', 'admin']
        && request.resource.data.user_id == resource.data.user_id
        && request.resource.data.username == resource.data.username;

      allow delete: if false;
    }

    match /notifications/{id} {
      allow create: if signedIn()
        && request.resource.data.sender_id == request.auth.uid
        && request.resource.data.recipient_id is string
        && request.resource.data.text is string;

      allow read: if signedIn() && (
        resource.data.recipient_id == request.auth.uid
        || staff()
      );

      allow update, delete: if signedIn() && (
        resource.data.recipient_id == request.auth.uid
        || seniorStaff()
      );
    }

    match /staffLogs/{id} {
      allow read: if signedIn() && staff();

      allow create: if signedIn()
        && staff()
        && request.resource.data.actor_id == request.auth.uid
        && request.resource.data.action is string;

      allow update, delete: if signedIn() && owner();
    }
  }
}
