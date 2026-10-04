import Foundation
import Security

public enum GuardianAuthorizationError: Error, LocalizedError, Equatable {
  case createFailed(OSStatus)
  case externalizeFailed(OSStatus)
  case invalidExternalFormLength(Int)
  case restoreFailed(OSStatus)
  case rightDenied(OSStatus)

  public var errorDescription: String? {
    switch self {
    case .createFailed(let status):
      "Unable to create administrator authorization (OSStatus \(status))."
    case .externalizeFailed(let status):
      "Unable to externalize administrator authorization (OSStatus \(status))."
    case .invalidExternalFormLength(let count):
      "Authorization references must be exactly \(GuardianConstants.authorizationExternalFormLength) bytes, not \(count)."
    case .restoreFailed(let status):
      "Unable to restore administrator authorization (OSStatus \(status))."
    case .rightDenied(let status):
      "Administrator authorization was denied or expired (OSStatus \(status))."
    }
  }
}

public enum GuardianAuthorization {
  public static func requestAdministratorExternalForm() throws -> Data {
    var authorization: AuthorizationRef?
    let createStatus = AuthorizationCreate(nil, nil, [], &authorization)
    guard createStatus == errAuthorizationSuccess, let authorization else {
      throw GuardianAuthorizationError.createFailed(createStatus)
    }
    defer { AuthorizationFree(authorization, [.destroyRights]) }

    try copyAdministratorRight(
      authorization,
      flags: [.interactionAllowed, .extendRights, .preAuthorize]
    )

    var externalForm = AuthorizationExternalForm()
    let externalizeStatus = AuthorizationMakeExternalForm(authorization, &externalForm)
    guard externalizeStatus == errAuthorizationSuccess else {
      throw GuardianAuthorizationError.externalizeFailed(externalizeStatus)
    }
    return withUnsafeBytes(of: externalForm) { Data($0) }
  }

  public static func validateAdministratorExternalForm(_ data: Data) throws {
    guard data.count == GuardianConstants.authorizationExternalFormLength else {
      throw GuardianAuthorizationError.invalidExternalFormLength(data.count)
    }

    var externalForm = AuthorizationExternalForm()
    _ = withUnsafeMutableBytes(of: &externalForm) { destination in
      data.copyBytes(to: destination)
    }

    var authorization: AuthorizationRef?
    let restoreStatus = AuthorizationCreateFromExternalForm(&externalForm, &authorization)
    guard restoreStatus == errAuthorizationSuccess, let authorization else {
      throw GuardianAuthorizationError.restoreFailed(restoreStatus)
    }
    defer { AuthorizationFree(authorization, []) }

    // The privileged process deliberately disallows UI. The caller must have
    // pre-authorized the right immediately before sending the XPC request.
    try copyAdministratorRight(authorization, flags: [])
  }

  private static func copyAdministratorRight(
    _ authorization: AuthorizationRef,
    flags: AuthorizationFlags
  ) throws {
    let status = GuardianConstants.administratorRight.withCString { rightName in
      var item = AuthorizationItem(name: rightName, valueLength: 0, value: nil, flags: 0)
      return withUnsafeMutablePointer(to: &item) { pointer in
        var rights = AuthorizationRights(count: 1, items: pointer)
        return AuthorizationCopyRights(authorization, &rights, nil, flags, nil)
      }
    }
    guard status == errAuthorizationSuccess else {
      throw GuardianAuthorizationError.rightDenied(status)
    }
  }
}
