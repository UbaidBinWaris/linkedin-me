def detect_page_type(html: str) -> str:
    """Step 1: Page Type Detection.
    
    Determines if the page is a profile, login wall, captcha, etc.
    Returns: "profile", "login_wall", "auth_wall", "captcha", "restricted", or "unknown".
    """
    html_lower = html.lower()

    # Check for login wall
    if "join linkedin" in html_lower:
        return "login_wall"

    # Check for auth wall / sign in
    if "sign in" in html_lower or "log in" in html_lower:
        if "forgot password" in html_lower or "username" in html_lower:
            return "auth_wall"

    # Check for captcha
    if "captcha" in html_lower or "security check" in html_lower or "challenge" in html_lower:
        return "captcha"
        
    # Check for restricted/unavailable
    if "profile is not available" in html_lower or "restricted" in html_lower:
        return "restricted"

    # Check for profile markers (e.g., presence of h1 and not the above)
    if "<h1" in html_lower:
        # If it's a profile, it usually has the name in h1
        # We assume if it's not a wall, it's a profile
        return "profile"

    return "unknown"
