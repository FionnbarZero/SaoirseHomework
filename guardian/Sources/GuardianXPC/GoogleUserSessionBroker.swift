import CryptoKit
import Foundation
import Security

public struct UserBrokerParentChallenge: Decodable {
  public let id: String
  public let purpose: String
  public let purposeLabel: String
}

public struct UserBrokerOperationPayload: Codable {
  public let clientId: String?
  public let clientSecret: String?
  public let redirectUri: String?
  public let scopes: [String]?
  public let state: String?
  public let code: String?
  public let error: String?
}

public struct UserBrokerOperation: Decodable {
  public let id: String
  public let kind: String
  public let payload: UserBrokerOperationPayload
  public let expiresAt: String
}

public struct UserBrokerWork: Decodable {
  public let parentAuthorizationChallenge: UserBrokerParentChallenge?
  public let operation: UserBrokerOperation?
}

public struct UserBrokerOperationResult: Encodable {
  public let authorizationUrl: String?
  public let expiresAt: String?
  public let accessToken: String?
  public let accountEmail: String?
  public let revocationWarning: String?

  public init(
    authorizationUrl: String? = nil,
    expiresAt: String? = nil,
    accessToken: String? = nil,
    accountEmail: String? = nil,
    revocationWarning: String? = nil
  ) {
    self.authorizationUrl = authorizationUrl
    self.expiresAt = expiresAt
    self.accessToken = accessToken
    self.accountEmail = accountEmail
    self.revocationWarning = revocationWarning
  }
}

public enum GoogleUserSessionBrokerError: Error, LocalizedError {
  case authorizationDenied(String)
  case authorizationExpired
  case incompleteOperation
  case invalidResponse
  case keychain(OSStatus)
  case network(String)
  case unsupportedOperation(String)

  public var errorDescription: String? {
    switch self {
    case .authorizationDenied(let reason):
      "Google authorization was not completed: \(reason)"
    case .authorizationExpired:
      "The Google authorization request expired or could not be verified."
    case .incompleteOperation:
      "The root service sent an incomplete Google credential operation."
    case .invalidResponse:
      "Google returned an invalid credential response."
    case .keychain(let status):
      "The login Keychain operation failed (Security status \(status))."
    case .network(let message):
      "The Google credential request failed: \(message)"
    case .unsupportedOperation(let kind):
      "The root service requested unsupported credential operation \(kind)."
    }
  }
}

private struct PendingGoogleAuthorization: Codable {
  let verifier: String
  let clientID: String
  let clientSecret: String
  let redirectURI: String
  let createdAt: Date
}

private struct GoogleTokenResponse: Decodable {
  let accessToken: String?
  let refreshToken: String?
  let expiresIn: Int?
  let errorDescription: String?

  enum CodingKeys: String, CodingKey {
    case accessToken = "access_token"
    case refreshToken = "refresh_token"
    case expiresIn = "expires_in"
    case errorDescription = "error_description"
  }
}

private struct GoogleUserInfo: Decodable {
  let email: String
}

private final class NetworkResultBox: @unchecked Sendable {
  private let lock = NSLock()
  private var value: Result<(Data, HTTPURLResponse), Error>?

  func set(_ value: Result<(Data, HTTPURLResponse), Error>) {
    lock.lock()
    defer { lock.unlock() }
    guard self.value == nil else { return }
    self.value = value
  }

  func get() -> Result<(Data, HTTPURLResponse), Error>? {
    lock.lock()
    defer { lock.unlock() }
    return value
  }
}

public final class GoogleUserSessionBroker {
  private static let authorizationEndpoint = URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!
  private static let tokenEndpoint = URL(string: "https://oauth2.googleapis.com/token")!
  private static let revokeEndpoint = URL(string: "https://oauth2.googleapis.com/revoke")!
  private static let userInfoEndpoint = URL(string: "https://openidconnect.googleapis.com/v1/userinfo")!
  private static let refreshService = "com.fionnbar.homework.google"
  private static let refreshAccount = "oauth-refresh-token"
  private static let pendingService = "com.fionnbar.homework.google.pending"

  private let session: URLSession

  public init() {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 20
    configuration.timeoutIntervalForResource = 30
    session = URLSession(configuration: configuration)
  }

  public func process(_ operation: UserBrokerOperation) throws -> UserBrokerOperationResult {
    switch operation.kind {
    case "google_begin_authorization":
      return try beginAuthorization(operation.payload)
    case "google_complete_authorization":
      return try completeAuthorization(operation.payload)
    case "google_access_token":
      return try refreshAccessToken(operation.payload)
    case "google_disconnect":
      return disconnect(operation.payload)
    default:
      throw GoogleUserSessionBrokerError.unsupportedOperation(operation.kind)
    }
  }

  private func beginAuthorization(
    _ payload: UserBrokerOperationPayload
  ) throws -> UserBrokerOperationResult {
    guard let clientID = nonempty(payload.clientId),
          let redirectURI = nonempty(payload.redirectUri),
          let scopes = payload.scopes,
          !scopes.isEmpty else {
      throw GoogleUserSessionBrokerError.incompleteOperation
    }
    let state = try randomData(count: 32).base64URLEncodedString()
    let verifier = try randomData(count: 64).base64URLEncodedString()
    let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()
    let pending = PendingGoogleAuthorization(
      verifier: verifier,
      clientID: clientID,
      clientSecret: payload.clientSecret ?? "",
      redirectURI: redirectURI,
      createdAt: Date()
    )
    try storeKeychain(
      service: Self.pendingService,
      account: state,
      data: try GuardianWireCodec.encode(pending)
    )

    var components = URLComponents(url: Self.authorizationEndpoint, resolvingAgainstBaseURL: false)!
    components.queryItems = [
      URLQueryItem(name: "client_id", value: clientID),
      URLQueryItem(name: "redirect_uri", value: redirectURI),
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "scope", value: scopes.joined(separator: " ")),
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "code_challenge", value: challenge),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
      URLQueryItem(name: "access_type", value: "offline"),
      URLQueryItem(name: "prompt", value: "consent"),
      URLQueryItem(name: "include_granted_scopes", value: "true"),
    ]
    guard let url = components.url else { throw GoogleUserSessionBrokerError.invalidResponse }
    return UserBrokerOperationResult(
      authorizationUrl: url.absoluteString,
      expiresAt: iso8601(Date().addingTimeInterval(10 * 60))
    )
  }

  private func completeAuthorization(
    _ payload: UserBrokerOperationPayload
  ) throws -> UserBrokerOperationResult {
    guard let state = nonempty(payload.state) else {
      throw GoogleUserSessionBrokerError.incompleteOperation
    }
    defer { try? deleteKeychain(service: Self.pendingService, account: state) }
    if let reason = nonempty(payload.error) {
      throw GoogleUserSessionBrokerError.authorizationDenied(reason)
    }
    guard let code = nonempty(payload.code),
          let pendingData = try readKeychain(service: Self.pendingService, account: state),
          let pending = try? GuardianWireCodec.decode(PendingGoogleAuthorization.self, from: pendingData),
          Date().timeIntervalSince(pending.createdAt) <= 10 * 60 else {
      throw GoogleUserSessionBrokerError.authorizationExpired
    }
    let tokens = try tokenRequest([
      "client_id": pending.clientID,
      "client_secret": pending.clientSecret,
      "code": code,
      "code_verifier": pending.verifier,
      "grant_type": "authorization_code",
      "redirect_uri": pending.redirectURI,
    ])
    guard let refreshToken = nonempty(tokens.refreshToken) else {
      throw GoogleUserSessionBrokerError.invalidResponse
    }
    try storeKeychain(
      service: Self.refreshService,
      account: Self.refreshAccount,
      data: Data(refreshToken.utf8)
    )
    guard let accessToken = nonempty(tokens.accessToken) else {
      throw GoogleUserSessionBrokerError.invalidResponse
    }
    let user = try userInfo(accessToken: accessToken)
    return accessResult(tokens, accountEmail: user.email)
  }

  private func refreshAccessToken(
    _ payload: UserBrokerOperationPayload
  ) throws -> UserBrokerOperationResult {
    guard let clientID = nonempty(payload.clientId),
          let refreshData = try readKeychain(
            service: Self.refreshService,
            account: Self.refreshAccount
          ),
          let refreshToken = String(data: refreshData, encoding: .utf8),
          !refreshToken.isEmpty else {
      throw GoogleUserSessionBrokerError.authorizationExpired
    }
    let tokens = try tokenRequest([
      "client_id": clientID,
      "client_secret": payload.clientSecret ?? "",
      "refresh_token": refreshToken,
      "grant_type": "refresh_token",
    ])
    return accessResult(tokens)
  }

  private func disconnect(_ payload: UserBrokerOperationPayload) -> UserBrokerOperationResult {
    var warning: String?
    do {
      if let refreshData = try readKeychain(
        service: Self.refreshService,
        account: Self.refreshAccount
      ), let refreshToken = String(data: refreshData, encoding: .utf8), !refreshToken.isEmpty {
        var request = URLRequest(url: Self.revokeEndpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = formData(["token": refreshToken])
        let (_, response) = try perform(request)
        if !(200..<300).contains(response.statusCode) {
          warning = "Google revocation could not be confirmed; the login Keychain token was removed."
        }
      }
    } catch {
      warning = "Google revocation could not be confirmed; the login Keychain token was removed."
    }
    do {
      try deleteKeychain(service: Self.refreshService, account: Self.refreshAccount)
    } catch {
      warning = "The Google connection was disabled, but its login Keychain token could not be removed."
    }
    return UserBrokerOperationResult(revocationWarning: warning)
  }

  private func tokenRequest(_ values: [String: String]) throws -> GoogleTokenResponse {
    var request = URLRequest(url: Self.tokenEndpoint)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = formData(values.filter { !$0.value.isEmpty })
    let (data, response) = try perform(request)
    guard let tokens = try? JSONDecoder().decode(GoogleTokenResponse.self, from: data),
          (200..<300).contains(response.statusCode),
          nonempty(tokens.accessToken) != nil else {
      let detail = (try? JSONDecoder().decode(GoogleTokenResponse.self, from: data).errorDescription)
      throw GoogleUserSessionBrokerError.network(detail ?? "Google rejected the token request.")
    }
    return tokens
  }

  private func userInfo(accessToken: String) throws -> GoogleUserInfo {
    var request = URLRequest(url: Self.userInfoEndpoint)
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    let (data, response) = try perform(request)
    guard (200..<300).contains(response.statusCode),
          let user = try? JSONDecoder().decode(GoogleUserInfo.self, from: data),
          !user.email.isEmpty else {
      throw GoogleUserSessionBrokerError.invalidResponse
    }
    return user
  }

  private func perform(_ request: URLRequest) throws -> (Data, HTTPURLResponse) {
    let semaphore = DispatchSemaphore(value: 0)
    let box = NetworkResultBox()
    session.dataTask(with: request) { data, response, error in
      if let error {
        box.set(.failure(error))
      } else if let data, let response = response as? HTTPURLResponse {
        box.set(.success((data, response)))
      } else {
        box.set(.failure(GoogleUserSessionBrokerError.invalidResponse))
      }
      semaphore.signal()
    }.resume()
    guard semaphore.wait(timeout: .now() + 31) == .success,
          let result = box.get() else {
      throw GoogleUserSessionBrokerError.network("The request timed out.")
    }
    do {
      let value = try result.get()
      guard value.0.count <= 1_048_576 else {
        throw GoogleUserSessionBrokerError.invalidResponse
      }
      return value
    } catch let error as GoogleUserSessionBrokerError {
      throw error
    } catch {
      throw GoogleUserSessionBrokerError.network(error.localizedDescription)
    }
  }

  private func accessResult(
    _ tokens: GoogleTokenResponse,
    accountEmail: String? = nil
  ) -> UserBrokerOperationResult {
    let lifetime = max(60, tokens.expiresIn ?? 3_600)
    return UserBrokerOperationResult(
      expiresAt: iso8601(Date().addingTimeInterval(TimeInterval(lifetime))),
      accessToken: tokens.accessToken,
      accountEmail: accountEmail
    )
  }

  private func formData(_ values: [String: String]) -> Data {
    var components = URLComponents()
    components.queryItems = values.sorted { $0.key < $1.key }.map {
      URLQueryItem(name: $0.key, value: $0.value)
    }
    return Data((components.percentEncodedQuery ?? "").utf8)
  }

  private func randomData(count: Int) throws -> Data {
    var bytes = [UInt8](repeating: 0, count: count)
    let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    guard status == errSecSuccess else { throw GoogleUserSessionBrokerError.keychain(status) }
    return Data(bytes)
  }

  private func readKeychain(service: String, account: String) throws -> Data? {
    var query: [String: Any] = baseKeychainQuery(service: service, account: account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw GoogleUserSessionBrokerError.keychain(status)
    }
    return data
  }

  private func storeKeychain(service: String, account: String, data: Data) throws {
    let query = baseKeychainQuery(service: service, account: account)
    let updateStatus = SecItemUpdate(
      query as CFDictionary,
      [kSecValueData as String: data] as CFDictionary
    )
    if updateStatus == errSecSuccess { return }
    guard updateStatus == errSecItemNotFound else {
      throw GoogleUserSessionBrokerError.keychain(updateStatus)
    }
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrLabel as String] = "Fionnbar Homework Google authorization"
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let addStatus = SecItemAdd(item as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
      throw GoogleUserSessionBrokerError.keychain(addStatus)
    }
  }

  private func deleteKeychain(service: String, account: String) throws {
    let status = SecItemDelete(baseKeychainQuery(service: service, account: account) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw GoogleUserSessionBrokerError.keychain(status)
    }
  }

  private func baseKeychainQuery(service: String, account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrSynchronizable as String: false,
    ]
  }

  private func nonempty(_ value: String?) -> String? {
    guard let value, !value.isEmpty else { return nil }
    return value
  }

  private func iso8601(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }
}
