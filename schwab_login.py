"""One-time (or once every 7 days) interactive login.

Opens the Schwab authorization page in your default browser. After you
log in and approve access, Schwab redirects to your callback URL
(https://127.0.0.1 by default) with a `code` query parameter, even
though nothing is actually listening there — just copy the full
resulting URL from the address bar and paste it back here.
"""
import urllib.parse
import webbrowser

from schwab_auth import build_authorize_url, exchange_code_for_tokens

def main():
    url = build_authorize_url()
    print("Opening browser for Schwab login...")
    print(url)
    webbrowser.open(url)

    redirected_url = input(
        "\nAfter approving access, paste the full URL you were redirected to: "
    ).strip()

    query = urllib.parse.urlparse(redirected_url).query
    params = urllib.parse.parse_qs(query)
    if "code" not in params:
        raise SystemExit("No `code` parameter found in that URL.")

    auth_code = params["code"][0]  # parse_qs already URL-decodes this
    exchange_code_for_tokens(auth_code)
    print("Logged in. Tokens saved to tokens.json.")


if __name__ == "__main__":
    main()
