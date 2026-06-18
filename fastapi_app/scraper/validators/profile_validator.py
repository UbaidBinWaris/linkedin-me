def validate_profile(profile_data):
    """Step 3: Validation Rules & Quality Score.
    
    Returns the profile_data with quality_score if valid, or None if invalid.
    """
    if not profile_data.get("full_name"):
        print("Validation failed: Missing full_name")
        return None

    if len(profile_data["full_name"]) < 2:
        print("Validation failed: full_name too short")
        return None
        
    if profile_data["full_name"] == "Join LinkedIn":
        print("Validation failed: Name is 'Join LinkedIn' (likely login wall)")
        return None

    # Step 8: Profile Quality Score
    score = 0
    if profile_data.get("full_name"): score += 1
    if profile_data.get("headline"): score += 1
    if profile_data.get("about"): score += 1
    if profile_data.get("followers", 0) > 0: score += 1
    
    print(f"Profile Quality Score: {score}/4")
    
    # Require at least score 2 (e.g., name + headline or name + followers)
    if score < 2:
        print("Validation failed: Quality score too low")
        return None

    profile_data["quality_score"] = score
    return profile_data
