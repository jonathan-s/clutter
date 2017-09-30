// ==============================================================================
// EXPOSED Functions: visible to the UI, can be called via localhost, web browser, or socket
// ===============================================================================

var AppID = App.Key.Hash;
var Me = App.Agent.String;

// Retrieves a property of the holochain from the DNA (e.g., Name, Language)
function getProperty(name)
{
    return property(name);
}

// Expects a userAddress hash of the person you want to follow
function follow(userAddress)
{

    return commit("follow", // Commit a new follow entry to my source chain
        { Links:[
            { Base:userAddress, Link:AppID, Tag:"follower" }, // On the DHT, puts a link on their hash to my hash as a "follower"
            { Base:AppID, Link:userAddress, Tag:"following" } // On the DHT, puts a link on my hash to their hash as a "following"
        ]});
}

function unfollow(userAddress)
{
    var me = getMe();
    return commit("unfollow",  // On my source chain, commits the unfollow entry
                  {Links:[
                      {Base:userAddress,Link:me,Tag:"follower",LinkAction:HC.LinkAction.Del},
                      {Base:me,Link:userAddress,Tag:"following",LinkAction:HC.LinkAction.Del}
                  ]});
}

function post(post)
{
    var post_hash = commit("post",post);        // Commits the post block to my source chain, assigns resulting hash to 'key'
    var me = getMe();                       // Looks up my hash address and assign it to 'me'
                                            // which DHT nodes will use to request validation info from my source chain
    commit("post_links", { Links: [{ Base:me, Link:post_hash, Tag:"post" }] });

    call("holodex","indexObject",{content:post.message,objHash:post_hash});

    var hashTag_List = call("anchorHashtag", "detectHashtags", post.message);

    if (hashTag_List != null)
    {
        for(var i in hashTag_List)
        {
            var ht = hashTag_List[i];
            call ("anchorHashtag","LinkorCreateHT",ht,post_hash);
      	}
    }

    return post_hash; // Returns the hash key of the new post to the calling function
}

function searchPost(searchString)
{
    var postHashes = call("holodex","searchContent",searchString);
    var postHashArr = postHashes.split(',');;
    var posts = new Array(postHashArr.length);

    for(var i=0; i < postHashArr.length; i++)
    {
        posts[i] = get(postHashArr[i],{GetMask:HC.GetMask.Entry});
    }

    return posts;
}

function postMod(params) {
    var hash = params.hash;
    var post = params.post;

    return update("post",post,hash);
}

// TODO add "last 10" or "since timestamp" when query info is supported
function getPostsBy(userAddresses) {
    // From the DHT, gets all "post" metadata entries linked from this userAddress
    var posts = [];
    for (var i=0;i<userAddresses.length;i++) {
        var author = userAddresses[i];
        var authorPosts = doGetLinkLoad(author,"post");
        
        // add in the author
        for(var j=0;j<authorPosts.length;j++) {
            var post = JSON.parse(authorPosts[j].post);
            post.author = author;
            post.hash = authorPosts[j].H;
            posts.push(post);
        }
    }
    return posts;
}

// get a list of all the people from the DHT a user is following or follows
function getFollow(params) {
    var type = params.type;
    var base = params.from;
    var result = {};

    if ((type == "follows") || (type == "following")) {
        result["result"] = dogetLinks(base,type);
    }
    else {
        result["error"] = "bad type: "+type;
    }

    return result;
}

function newHandle(handle)
{
    var me = getMe();
    var directory = getDirectory();
    var handles = dogetLinks(me,"handle");
    var n = handles.length - 1;

    if (n >= 0) {
        var oldKey = handles[n];
        var key = update("handle",handle,oldKey);

        commit("handle_links",
               {Links:[
                   {Base:me,Link:oldKey,Tag:"handle",LinkAction:HC.LinkAction.Del},
                   {Base:me,Link:key,Tag:"handle"}
               ]});
        commit("directory_links",
               {Links:[
                   {Base:directory,Link:oldKey,Tag:"handle",LinkAction:HC.LinkAction.Del},
                   {Base:directory,Link:key,Tag:"handle"}
               ]});
        return key;
    }
    return addHandle(handle);
}


// returns the handle of an agent by looking it up on the user's DHT entry, the last handle will be the current one?
function getHandle(userHash) {
    var handles = doGetLinkLoad(userHash,"handle");
    var n = handles.length -1;
    var h = handles[n];
    return (n >= 0) ? h.handle : "";
}

// returns the agent associated agent by converting the handle to a hash
// and getting that hash's source from the DHT
function getAgent(handle) {
    var directory = getDirectory();
    var handleHash = makeHash(handle);
    var sources = get(handleHash,{GetMask:HC.GetMask.Sources});

    if (isErr(sources)) {sources = [];}
    if (sources != undefined) {
        var n = sources.length -1;
        return (n >= 0) ? sources[n] : "";
    }
    return "";
}

function getHashtag(handle) {
    var directory = getDirectory();
    var handleHash = makeHash(handle);
    var sources = get(handleHash,{GetMask:HC.GetMask.Sources});

    if (isErr(sources)) {sources = [];}
    if (sources != undefined) {
        var n = sources.length -1;
        return (n >= 0) ? sources[n] : "";
    }
    return "";
}
// ==============================================================================
// HELPERS: unexposed functions
// ==============================================================================


// helper function to resolve which hash will be used as the base for the directory
// currently we just use the DNA hash as our entry for linking the directory to
// TODO commit an anchor entry explicitly for this purpose.
function getDirectory() {return App.DNA.Hash;}


// helper function to actually commit a handle and its links on the directory
// this function gets called at genesis time only because all other times handle gets
// updated using newHandle

function addHandle(handle) {
    // TODO confirm no collision
    var key = commit("handle",handle);        // On my source chain, commits a new handle entry
    var directory = getDirectory();

    commit("handle_links", {Links:[{Base:AppID,Link:key,Tag:"handle"}]});
    commit("directory_links", {Links:[{Base:directory,Link:key,Tag:"handle"}]});

    return key;
}

// helper function to determine if value returned from holochain function is an error
function isErr(result) {
    return ((typeof result === 'object') && result.name == "HolochainError");
}

// helper function to do getLink call, handle the no-link error case, and copy the returned entry values into a nicer array
function doGetLinkLoad(base, tag)
{
    // get the tag from the base in the DHT
    var links = getLinks(base, tag,{Load:true});
    
    if (isErr(links)) {
        links = [];
    } else {
        links = links.Links;
    }
    
    var links_filled = [];

    for (var i=0;i <links.length;i++) {
        var link = {H:links[i].H};
        link[tag] = links[i].E;
        links_filled.push(link);
    }

    return links_filled;
}

// helper function to call getLinks, handle the no links entry error, and build a simpler links array.
function dogetLinks(base,tag)
{
    // get the tag from the base in the DHT
    var links = getLinks(base, tag,{Load:true});

    if (isErr(links)) {
        links = [];
    }
     else {
        links = links.Links;
    }

    var links_filled = [];
    for (var i=0;i <links.length;i++) {
        links_filled.push(links[i].H);
    }

    return links_filled;
}

// ==============================================================================
// CALLBACKS: Called by back-end system, instead of front-end app or UI
// ===============================================================================

// GENESIS - Called only when your source chain is generated:'hc gen chain <name>'
// ===============================================================================
function genesis()
{                            // 'hc gen chain' calls the genesis function in every zome file for the app
    // use the agent string (usually email) used with 'hc init' to identify myself and create a new handle
    addHandle(App.Agent.String);
    return true;
}

// ===============================================================================
//   VALIDATION functions for *EVERY* change made to DHT entry -
//     Every DHT node uses their own copy of these functions to validate
//     any and all changes requested before accepting. put / mod / del & metas
// ===============================================================================

function validateCommit(entry_type,entry,header,pkg,sources) {
    return validate(entry_type,entry,header,sources);
}

function validatePut(entry_type,entry,header,pkg,sources) {
    return validate(entry_type,entry,header,sources);
}

function validate(entry_type,entry,header,sources)
{
    if (entry_type=="post") {
        var l = entry.message.length;
        if (l > 0 && l < 256) { return true; }
        return false;
    }

    if (entry_type=="handle") {
        return true;
    }

    if (entry_type=="follow") {
        return true;
    }

    return true;
}

// Are there types of tags that you need special permission to add links?
// Examples:
//   - Only Bob should be able to make Bob a "follower" of Alice
//   - Only Bob should be able to list Alice in his people he is "following"
function validateLink(linkEntryType,baseHash,links,pkg,sources)
{
    if (linkEntryType=="handle_links") {
        var length = links.length;
        // a valid handle is when:

        // there should just be one or two links only
        if (length==2) {
            // if this is a modify it will have two links the first of which
            // will be the del and the second the new link.
            if (links[0].LinkAction != HC.LinkAction.Del) return false;
            if (links[1].LinkAction != HC.LinkAction.Add) return false;
        } else if (length==1) {
            // if this is a new handle, there will just be one Add link
            if (links[0].LinkAction != HC.LinkAction.Add) return false;
        } else {return false;}

        for (var i=0;i<length;i++) {
            var link = links[i];
            // the base must be this base
            if (link.Base != baseHash) return false;
            // the base must be the source
            if (link.Base != sources[0]) return false;
            // The tag name should be "handle"
            if (link.Tag != "handle") return false;
            //TODO check something about the link, i.e. get it and check it's type?
        }
        return true;
    }
    return true;
}
function validateMod(entry_type,entry,header,replaces,pkg,sources)
{
    if (entry_type == "handle")
    {
        // check that the source is the same as the creator
        // TODO we could also check that the previous link in the type-chain is the replaces hash.
        var orig_sources = get(replaces,{GetMask:HC.GetMask.Sources});
        
        if (isErr(orig_sources) || orig_sources == undefined || orig_sources.length !=1 || orig_sources[0] != sources[0]) {
            return false;
        }

    }
    else if (entry_type == "post")
    {
        // there must actually be a message
        if (entry.message == "") return false;
        var orig = get(replaces,{GetMask:HC.GetMask.Sources+HC.GetMask.Entry});

        // check that source is same as creator
        if (orig.Sources.length !=1 || orig.Sources[0] != sources[0]) {return false;}

        var orig_message = JSON.parse(orig.Entry.C).message;
        // message must actually be different
        return orig_message != entry.message;
    }
    
    return true;
}

function validateDel(entry_type,hash,pkg,sources)
{
    return true;
}

// ===============================================================================
//   PACKAGING functions for *EVERY* validation call for DHT entry
//     What data needs to be sent for each above validation function?
//     Default: send and sign the chain entry that matches requested HASH
// ===============================================================================

function validatePutPkg(entry_type) {return null;}
function validateModPkg(entry_type) { return null;}
function validateDelPkg(entry_type) { return null;}
function validateLinkPkg(entry_type) { return null;}
