from typing import TypedDict, Optional
from bs4 import BeautifulSoup
import re

class ParsedProfile(TypedDict):
    full_name: str
    headline: str
    about: str
    followers: int
    connections: int
    location: str

class ProfileParser:
    def __init__(self, html_content: str):
        self.soup = BeautifulSoup(html_content, "html.parser")

    def parse_name(self) -> str:
        """Extract full name from profile."""
        # Heuristic: The main h1 is usually the name
        h1 = self.soup.find("h1")
        if h1:
            return h1.get_text(strip=True)
        return ""

    def parse_headline(self) -> str:
        """Extract headline (job title/description)."""
        # Heuristic: Headline is often in a div near the h1
        h1 = self.soup.find("h1")
        if h1:
            parent = h1.parent
            if parent:
                # Look for the text content that isn't the h1
                # Often in a div with class like "text-body-medium"
                # We'll try to find text that is not the name
                for element in parent.find_all(recursive=False):
                    if element.name != "h1":
                        text = element.get_text(strip=True)
                        if text:
                            return text
        return ""

    def parse_about(self) -> str:
        """Extract 'About' section."""
        # Heuristic: Look for a section containing the word "About" in a header
        for section in self.soup.find_all("section"):
            header = section.find(["h2", "h3"], string=re.compile(r"^About$", re.I))
            if not header:
                header = section.find(string=re.compile(r"About this profile", re.I))
                
            if header:
                # Return the text content of the section, excluding the header
                text = section.get_text(separator="\n", strip=True)
                header_text = header.get_text(strip=True)
                return text.replace(header_text, "").strip()
        return ""

    def parse_followers(self) -> int:
        """Extract follower count."""
        # Heuristic: Look for text like "1,234 followers"
        text_node = self.soup.find(string=re.compile(r"[\d,.]+\s+followers", re.I))
        if text_node:
            match = re.search(r"([\d,.]+)", text_node)
            if match:
                # Remove commas and periods used as thousands separators
                val_str = match.group(1).replace(",", "").replace(".", "")
                try:
                    return int(val_str)
                except ValueError:
                    return 0
        return 0

    def parse_location(self) -> str:
        """Extract location."""
        # Heuristic: Location is often near the follower count or in the header area
        # Often looks like "City, Country"
        # This is harder to find without classes.
        # Let's look for a common pattern or a specific icon parent
        # For now, we return empty as a placeholder to avoid garbage data
        return ""

    def parse_profile(self) -> ParsedProfile:
        """Combine all fields into a structured dict."""
        return {
            "full_name": self.parse_name(),
            "headline": self.parse_headline(),
            "about": self.parse_about(),
            "followers": self.parse_followers(),
            "connections": 0, # Placeholder
            "location": self.parse_location()
        }

    def validate(self, data: ParsedProfile) -> bool:
        """Step 6: Validation Layer."""
        if not data["full_name"]:
            print("Validation failed: Missing full_name")
            return False
        if data["followers"] < 0:
            print("Validation failed: Negative followers")
            return False
        return True
